import { ARCHETYPES, SUMMONS, UNIVERSAL_PROMPT } from "../config/archetypes.js";
import prisma from "./db.js";
import { Message, Provider, askProvider, askProviderStream } from "./providers.js";
import logger from "./logger.js";

/**
 * Typed input shape for council member configuration.
 * Matches what the API receives before archetype assignment.
 */
export interface CouncilMemberInput {
  name?: string;
  type: "openai-compat" | "anthropic" | "google";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxTokens?: number;
  tools?: string[];
  /** UI-level fields (role/tone/customBehaviour) passed through transparently */
  [key: string]: unknown;
}

/**
 * Prepares council members by assigning archetypes based on the selected summon type.
 */
export async function prepareCouncilMembers(members: CouncilMemberInput[], summon?: string, userId?: number) {
  if (!members || members.length === 0) return [];

  if (members.length === 1) {
    return [{
      ...members[0],
      name: members[0].name || "Council Member",
      systemPrompt: UNIVERSAL_PROMPT
    }];
  }

  const summonKey = (summon && SUMMONS[summon]) ? summon : "default";
  const archetypeOrder = SUMMONS[summonKey];

  const userArchetypes: Record<string, any> = {};
  if (userId) {
    const config = await prisma.councilConfig.findUnique({ where: { userId } });
    if (config) {
      const customs = (config.config as any).customArchetypes || [];
      customs.forEach((a: any) => { userArchetypes[a.id] = a; });
    }
  }

  const allArchetypes = { ...ARCHETYPES, ...userArchetypes };

  return members.map((member, index) => {
    const archetypeId = archetypeOrder[index % archetypeOrder.length];
    const archetype = allArchetypes[archetypeId] || ARCHETYPES.architect;

    // Assign tools based on archetype
    let tools = archetype.tools || [];
    if (archetypeId === "researcher") tools = ["web_search"];

    return {
      ...member,
      name: archetype.name,
      archetype: archetypeId,
      systemPrompt: member.systemPrompt || archetype.systemPrompt,
      tools
    };
  });
}

// ── Deliberation Event Types ──────────────────────────────────────────────────

export type DeliberationEvent =
  | { type: "status"; round: number; message: string }
  | { type: "opinion"; name: string; text: string; round: number }
  | { type: "member_chunk"; name: string; chunk: string }
  | { type: "done"; verdict: string; opinions: { name: string; opinion: string }[]; tokensUsed?: number };

/**
 * Concurrency limited map function to prevent unbounded parallel executions.
 */
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let index = 0;

  const executeWorker = async () => {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      try {
        results[currentIndex] = await fn(item);
      } catch (err: any) {
        logger.error({ err: err.message }, "mapConcurrent worker encountered an unhandled error");
        results[currentIndex] = undefined;
      }
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => executeWorker());
  await Promise.all(workers);

  return results;
}

export async function* deliberate(
  members: Provider[],
  master: Provider,
  messages: Message[],
  rounds: number = 1,
  abortSignal?: AbortSignal,
  maxTokens?: number,
  onVerdictChunk?: (chunk: string) => void,
  onMemberChunk?: (name: string, chunk: string) => void
): AsyncGenerator<DeliberationEvent> {
  const currentMessages = [...messages];
  let finalOpinions: { name: string; opinion: string }[] = [];
  let totalTokens = 0;

  for (let r = 1; r <= rounds; r++) {
    yield { type: "status", round: r, message: `Deliberation Round ${r} started` };

    const opinionsRaw = await mapConcurrent(members, 5, async (m) => {
      const agentTimeout = AbortSignal.timeout(45000);
      const combinedSignal = abortSignal
        ? AbortSignal.any([abortSignal, agentTimeout])
        : agentTimeout;

      try {
        let fullText = "";
        const response = await askProviderStream(
          { ...m, ...(maxTokens ? { maxTokens } : {}) },
          currentMessages,
          (chunk) => {
            fullText += chunk;
            if (onMemberChunk) onMemberChunk(m.name, chunk);
          },
          false,
          combinedSignal
        );
        if (response.usage) totalTokens += response.usage.totalTokens;
        return { name: m.name, opinion: response.text };
      } catch (err: any) {
        logger.error({ member: m.name, err: err.message }, "Agent failure in deliberation round");
        return { name: m.name, opinion: `[FAILED] Unable to provide an opinion: ${err.message}` };
      }
    });

    const opinions = opinionsRaw.filter((o): o is NonNullable<typeof o> => o !== undefined);
    finalOpinions = opinions;
    for (const op of opinions) {
      yield { type: "opinion", name: op.name, text: op.opinion, round: r };
    }

    if (opinions.length === 0) {
      yield { type: "status", round: r, message: `All agents failed to provide an opinion. Aborting.` };
      break;
    }

    const roundContext = opinions.map(o => `${o.name}: ${o.opinion}`).join("\n\n");
    currentMessages.push({ role: "assistant", content: `Round ${r} Opinions:\n${roundContext}` });

    if (r < rounds) {
      yield { type: "status", round: r, message: `Critic evaluating Round ${r}...` };
      const criticPrompt = `Evaluate the Round ${r} opinions. Point out contradictions, flawed assumptions, and missing evidence. Provide a directive for the next round of debate. If you believe a strong consensus has been reached and further debate is unnecessary, explicitly output "CONSENSUS_REACHED" in your evaluation.`;
      const criticEvalRes = await askProvider(master, [...currentMessages, { role: "user", content: criticPrompt }], false, abortSignal);
      if (criticEvalRes.usage) totalTokens += criticEvalRes.usage.totalTokens;
      const criticEval = criticEvalRes.text;
      yield { type: "opinion", name: "The Critic", text: criticEval, round: r };
      currentMessages.push({ role: "user", content: `Critic Evaluation & Directive for Round ${r + 1}:\n${criticEval}` });

      if (criticEval.includes("CONSENSUS_REACHED")) {
        yield { type: "status", round: r, message: `Consensus reached early by the Critic.` };
        break;
      }
    }
  }

  yield { type: "status", round: rounds, message: "Master synthesis started" };

  let verdict = "";
  const masterRes = await askProviderStream(
    { ...master, ...(maxTokens ? { maxTokens } : {}) },
    currentMessages,
    (chunk) => {
      verdict += chunk;
      if (onVerdictChunk) onVerdictChunk(chunk);
    },
    false,
    abortSignal
  );

  if (masterRes.usage) totalTokens += masterRes.usage.totalTokens;

  yield { type: "done", verdict, opinions: finalOpinions, tokensUsed: totalTokens } as any;
}

/**
 * Main Council Deliberation (Synchronous) — consumes the generator fully.
 */
export async function askCouncil(
  members: Provider[],
  master: Provider,
  messages: Message[],
  maxTokens?: number,
  rounds: number = 1
) {
  let verdict = "";
  let opinions: { name: string; opinion: string }[] = [];
  let tokensUsed = 0;

  for await (const event of deliberate(members, master, messages, rounds, undefined, maxTokens)) {
    if (event.type === "done") {
      verdict = event.verdict;
      opinions = event.opinions;
      tokensUsed = event.tokensUsed ?? 0;
    }
  }

  return { verdict, opinions, tokensUsed };
}

/**
 * Main Council Deliberation (Streaming) — pipes generator events to SSE callback.
 *
 * FIX: emits "verdict_chunk" (not "master_chunk") to match frontend handler.
 * FIX: emits opinion as { name, archetype, opinion } to match frontend Opinion type.
 */
export async function streamCouncil(
  members: Provider[],
  master: Provider,
  messages: Message[],
  onEvent: (event: string, data: any) => void,
  maxTokens?: number,
  rounds: number = 1,
  abortSignal?: AbortSignal
) {
  let verdict = "";
  const archetypeMap: Record<string, string> = {};
  for (const m of (members as any[])) {
    if (m.name && m.archetype) archetypeMap[m.name] = m.archetype;
  }

  for await (const event of deliberate(
    members, master, messages, rounds, abortSignal, maxTokens,
    // onVerdictChunk: name matches the frontend "verdict_chunk" case handler
    (chunk) => { onEvent("verdict_chunk", { chunk }); },
    // onMemberChunk: name matches the frontend "member_chunk" case handler
    (name, chunk) => { onEvent("member_chunk", { name, chunk }); }
  )) {
    if (event.type === "status") {
      onEvent("status", { message: event.message });
    } else if (event.type === "opinion") {
      const archetype = archetypeMap[event.name] || "";
      onEvent("opinion", { name: event.name, archetype, opinion: event.text });
    } else if (event.type === "done") {
      verdict = event.verdict;
      onEvent("done", event);
    }
  }

  return verdict;
}
