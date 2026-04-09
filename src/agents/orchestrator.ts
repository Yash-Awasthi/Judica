import { randomUUID } from "crypto";
import { AgentMessageBus, type Message } from "./messageBus.js";
import { detectConflicts, type AgentResponse, type Conflict } from "./conflictDetector.js";
import {
  addFact,
  getFactContext,
  extractAndStoreFacts,
  confirmFact,
  disputeFact,
} from "./sharedMemory.js";
import { routeAndCollect } from "../router/index.js";
import { hybridSearch } from "../services/vectorStore.service.js";
import { updateReliability, getReliabilityScores } from "../services/reliability.service.js";
import logger from "../lib/logger.js";


export interface CouncilMember {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  tools?: string[];
  personaId?: string;
}

export interface OrchestrationInput {
  query: string;
  conversationId: string;
  members: CouncilMember[];
  attachmentContext?: string; // pre-processed file/document text
  kbId?: string;
  researchMode?: boolean;
  tools?: string[];
  humanGates?: boolean;
  promptDna?: {
    systemPrompt: string;
    steeringRules: string;
    consensusBias: string;
    critiqueStyle: string;
  } | null;
}

export type OrchestrationEventType =
  | "preprocessing_complete"
  | "member_response"
  | "facts_extracted"
  | "conflicts_found"
  | "debate_exchange"
  | "tool_result"
  | "human_gate_pending"
  | "synthesis_complete"
  | "confidence_score"
  | "agent_message"
  | "orchestration_error";

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  data: Record<string, unknown>;
}

interface MemberResponse {
  memberId: string;
  memberName: string;
  text: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}


const pendingHumanGates = new Map<
  string,
  { resolve: (choice: string) => void; promise: Promise<string> }
>();

export function resolveHumanGate(gateId: string, choice: string): void {
  const gate = pendingHumanGates.get(gateId);
  if (gate) {
    gate.resolve(choice);
    pendingHumanGates.delete(gateId);
  }
}


export class DeliberationOrchestrator {
  private bus: AgentMessageBus;

  constructor() {
    this.bus = new AgentMessageBus();
  }

  async *run(input: OrchestrationInput): AsyncGenerator<OrchestrationEvent> {
    const {
      query,
      conversationId,
      members,
      attachmentContext,
      kbId,
      humanGates,
      promptDna,
    } = input;

    // ── 1. PREPROCESS ─────────────────────────────────────────────────────────

    let ragContext = "";
    if (kbId) {
      try {
        const chunks = await hybridSearch(members[0]?.id ? 0 : 0, query, kbId, 5);
        ragContext = chunks
          .map((c: any) => c.content)
          .join("\n\n");
      } catch (err) {
        logger.warn({ err }, "RAG retrieval failed during orchestration");
      }
    }

    const sharedFactCtx = await getFactContext(conversationId);

    yield {
      type: "preprocessing_complete",
      data: {
        hasRag: ragContext.length > 0,
        hasAttachments: !!attachmentContext,
        hasSharedFacts: sharedFactCtx.length > 0,
      },
    };

    // ── 2. DISPATCH (parallel) ────────────────────────────────────────────────

    // Register agents on the bus
    for (const member of members) {
      this.bus.registerAgent(member.id, member.name);
    }

    // Build base context
    const contextParts: string[] = [];
    if (promptDna?.systemPrompt) contextParts.push(promptDna.systemPrompt);
    if (ragContext) contextParts.push(`[RETRIEVED CONTEXT]\n${ragContext}\n[/RETRIEVED CONTEXT]`);
    if (attachmentContext) contextParts.push(`[ATTACHMENTS]\n${attachmentContext}\n[/ATTACHMENTS]`);
    if (sharedFactCtx) contextParts.push(sharedFactCtx);
    const baseContext = contextParts.join("\n\n");

    // Dispatch to all members in parallel
    const responsePromises = members.map(async (member): Promise<MemberResponse> => {
      this.bus.setAgentStatus(member.id, "thinking");

      const systemPrompt = [
        member.systemPrompt,
        baseContext,
        promptDna?.steeringRules ? `[STEERING RULES]\n${promptDna.steeringRules}\n[/STEERING RULES]` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await routeAndCollect(
        {
          model: member.model || "auto",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query },
          ],
          temperature: member.temperature ?? 0.7,
        },
        { preferredModel: member.model || undefined }
      );

      this.bus.setAgentStatus(member.id, "idle");

      return {
        memberId: member.id,
        memberName: member.name,
        text: result.text,
        usage: result.usage,
      };
    });

    const memberResponses = await Promise.all(responsePromises);

    for (const resp of memberResponses) {
      yield {
        type: "member_response",
        data: {
          memberId: resp.memberId,
          memberName: resp.memberName,
          text: resp.text,
          usage: resp.usage,
        },
      };
    }

    // ── 3. EXTRACT FACTS ──────────────────────────────────────────────────────

    let totalFacts = 0;
    const factPromises = memberResponses.map(async (resp) => {
      const facts = await extractAndStoreFacts(conversationId, resp.memberId, resp.text);
      return facts.length;
    });

    const factCounts = await Promise.all(factPromises);
    totalFacts = factCounts.reduce((a, b) => a + b, 0);

    yield { type: "facts_extracted", data: { count: totalFacts } };

    // ── 4. CONFLICT DETECTION ─────────────────────────────────────────────────

    const agentResponses: AgentResponse[] = memberResponses.map((r) => ({
      agentId: r.memberId,
      agentName: r.memberName,
      text: r.text,
    }));

    const conflicts = await detectConflicts(agentResponses);

    yield {
      type: "conflicts_found",
      data: {
        conflicts: conflicts.map((c) => ({
          agentA: c.agentA,
          agentB: c.agentB,
          claimA: c.claimA,
          claimB: c.claimB,
          severity: c.severity,
          type: c.contradictionType,
        })),
        count: conflicts.length,
      },
    };

    // ── 5. DEBATE ROUND ───────────────────────────────────────────────────────

    const debateExchanges: Message[] = [];

    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        const memberA = members.find((m) => m.id === conflict.agentA);
        const memberB = members.find((m) => m.id === conflict.agentB);
        if (!memberA || !memberB) continue;

        // Agent A sends critique to Agent B
        this.bus.setAgentStatus(memberA.id, "debating");
        this.bus.setAgentStatus(memberB.id, "debating");

        const critiqueMsg = this.bus.sendMessage(
          memberA.id,
          memberB.id,
          `I disagree with your claim: "${conflict.claimB}". My position: "${conflict.claimA}"`,
          "critique"
        );
        debateExchanges.push(critiqueMsg);

        yield {
          type: "debate_exchange",
          data: { from: memberA.name, to: memberB.name, content: critiqueMsg.content, type: "critique" },
        };
        yield {
          type: "agent_message",
          data: { from: memberA.name, to: memberB.name, content: critiqueMsg.content, type: "critique", timestamp: critiqueMsg.timestamp },
        };

        // Agent B generates rebuttal
        const rebuttalResult = await routeAndCollect({
          model: memberB.model || "auto",
          messages: [
            { role: "system", content: memberB.systemPrompt },
            {
              role: "user",
              content: `Another agent (${memberA.name}) challenges your claim: "${conflict.claimB}"\n\nTheir counter-claim: "${conflict.claimA}"\n\nProvide a rebuttal or concede if they are correct. Be specific and evidence-based.`,
            },
          ],
          temperature: memberB.temperature ?? 0.7,
        });

        const rebuttalType = rebuttalResult.text.toLowerCase().includes("concede") ||
          rebuttalResult.text.toLowerCase().includes("you are correct") ||
          rebuttalResult.text.toLowerCase().includes("i agree")
          ? "concession"
          : "rebuttal";

        const rebuttalMsg = this.bus.sendMessage(
          memberB.id,
          memberA.id,
          rebuttalResult.text,
          rebuttalType as Message["type"]
        );
        debateExchanges.push(rebuttalMsg);

        yield {
          type: "debate_exchange",
          data: { from: memberB.name, to: memberA.name, content: rebuttalResult.text, type: rebuttalType },
        };
        yield {
          type: "agent_message",
          data: { from: memberB.name, to: memberA.name, content: rebuttalResult.text, type: rebuttalType, timestamp: rebuttalMsg.timestamp },
        };

        this.bus.setAgentStatus(memberA.id, "idle");
        this.bus.setAgentStatus(memberB.id, "idle");
      }
    }

    // ── 6. RELIABILITY UPDATE ──────────────────────────────────────────────────

    // Build member->model map and track concessions for reliability scoring
    const memberModels = new Map<string, string>();
    for (const member of members) {
      if (member.model) memberModels.set(member.id, member.model);
    }

    const concessionAgentIds = debateExchanges
      .filter((m) => m.type === "concession")
      .map((m) => m.from);

    const reliabilityConflicts = conflicts.map((c) => ({
      agentA: c.agentA,
      agentB: c.agentB,
      modelA: memberModels.get(c.agentA),
      modelB: memberModels.get(c.agentB),
    }));

    await updateReliability(reliabilityConflicts, concessionAgentIds, memberModels);

    // ── 7. TOOL EXECUTION ─────────────────────────────────────────────────────
    // Tool execution is handled at the adapter level via routeAndCollect.
    // If tools are enabled, the LLM can invoke them during generation.
    // This phase is a placeholder for explicit tool orchestration if needed.

    // ── 8. HUMAN GATE ─────────────────────────────────────────────────────────

    if (humanGates && conflicts.length > 0) {
      const gateId = randomUUID();
      let gateResolve!: (choice: string) => void;
      const gatePromise = new Promise<string>((resolve) => {
        gateResolve = resolve;
      });
      pendingHumanGates.set(gateId, { resolve: gateResolve, promise: gatePromise });

      yield {
        type: "human_gate_pending",
        data: {
          gateId,
          prompt: "Agents have conflicting views. How should the system resolve?",
          options: [
            "Let agents continue debating",
            "Side with majority",
            "Override with my own answer",
            "Dismiss conflicts and synthesize",
          ],
        },
      };

      // Wait for human decision
      const choice = await gatePromise;

      if (choice === "Override with my own answer") {
        // The user's override would come through a separate mechanism
        // For now, proceed to synthesis
      }
    }

    // ── 9. SYNTHESIS ──────────────────────────────────────────────────────────

    // Load reliability scores for each member's model
    const uniqueModels = [...new Set(members.map((m) => m.model).filter(Boolean))];
    const reliabilityScores = await getReliabilityScores(uniqueModels);

    const updatedFactCtx = await getFactContext(conversationId);
    const allBusMessages = this.bus.getAllMessages();

    const synthesisInput: string[] = [
      `Original query: ${query}`,
      "",
      "=== AGENT RESPONSES ===",
      ...memberResponses.map((r) => `[${r.memberName}]:\n${r.text}`),
      "",
    ];

    if (allBusMessages.length > 0) {
      synthesisInput.push(
        "=== DEBATE EXCHANGES ===",
        ...allBusMessages.map(
          (m) => `[${m.from} → ${m.to}] (${m.type}): ${m.content.substring(0, 500)}`
        ),
        ""
      );
    }

    if (updatedFactCtx) {
      synthesisInput.push(updatedFactCtx, "");
    }

    // Add reliability scores so synthesizer can weight accordingly
    if (reliabilityScores.size > 0) {
      synthesisInput.push("=== MODEL RELIABILITY SCORES ===");
      for (const member of members) {
        const score = reliabilityScores.get(member.model);
        if (score) {
          synthesisInput.push(
            `[${member.name}] model=${member.model} reliability=${(score.avgConfidence * 100).toFixed(1)}% (${score.totalResponses} responses)`
          );
        }
      }
      synthesisInput.push(
        "Weight responses from higher-reliability models more heavily.",
        ""
      );
    }

    const consensusBias = promptDna?.consensusBias || "neutral";
    const synthesisPrompt = `You are a master synthesizer for an AI deliberation council.
Your bias mode is: ${consensusBias}.

Given the following agent responses, debate exchanges, and shared facts, produce a comprehensive consensus response.

Rules:
- Acknowledge areas of agreement
- Address resolved and unresolved conflicts
- Weight evidence-based claims higher than opinions
- If agents conceded points during debate, reflect that
- Provide a clear, actionable final answer
- Note confidence level and any remaining uncertainties

${synthesisInput.join("\n")}

Produce the final synthesis:`;

    const synthesisResult = await routeAndCollect({
      model: "auto",
      messages: [{ role: "user", content: synthesisPrompt }],
      temperature: 0.3,
    });

    yield {
      type: "synthesis_complete",
      data: {
        consensus: synthesisResult.text,
        usage: synthesisResult.usage,
      },
    };

    // ── 10. CONFIDENCE SCORE ──────────────────────────────────────────────────

    const totalClaims = totalFacts;
    const agreements = debateExchanges.filter((m) => m.type === "concession").length;
    const disagreements = debateExchanges.filter((m) => m.type === "rebuttal").length;

    const claimScore = totalClaims > 0
      ? (totalClaims - conflicts.length) / totalClaims
      : 1;
    const debateScore = (agreements + disagreements) > 0
      ? agreements / (agreements + disagreements)
      : 1;
    const memberCount = members.length;
    const diversityBonus = Math.min(memberCount / 5, 1) * 0.1;

    const confidence = Math.min(1, claimScore * 0.6 + debateScore * 0.3 + diversityBonus);

    yield {
      type: "confidence_score",
      data: {
        score: Math.round(confidence * 100) / 100,
        breakdown: {
          claimAgreement: Math.round(claimScore * 100) / 100,
          debateResolution: Math.round(debateScore * 100) / 100,
          diversityBonus: Math.round(diversityBonus * 100) / 100,
          totalConflicts: conflicts.length,
          totalConcessions: agreements,
          totalRebuttals: disagreements,
        },
      },
    };

    // ── 11. CLEANUP ──────────────────────────────────────────────────────────

    this.bus.reset();
  }
}
