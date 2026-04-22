import { routeAndCollect } from "../router/index.js";
import { mlWorker } from "../lib/ml/ml_worker.js";
import logger from "../lib/logger.js";

/** Sanitize user input before interpolation into LLM prompts */
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/\b(system|assistant|user|human)\s*:/gi, (_m, role) => `${role as string} -`)
    .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "[filtered]")
    .replace(/you\s+are\s+now\b/gi, "[filtered]");
}

/**
 * Goal Decomposition Engine: breaks high-level objectives into a
 * Directed Acyclic Graph (DAG) of subtasks with dependencies.
 */

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";

export interface SubTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  status: TaskStatus;
  assignedArchetype?: string;
  estimatedComplexity: "low" | "medium" | "high";
  output?: string;
  error?: string;
}

export interface TaskDAG {
  goal: string;
  tasks: SubTask[];
  createdAt: string;
}

/**
 * Decompose a high-level goal into a DAG of subtasks using LLM.
 */
export async function decomposeGoal(goal: string, context?: string): Promise<TaskDAG> {
  const contextBlock = context ? `\nContext: ${sanitizeForPrompt(context.substring(0, 2000))}` : "";

  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Break this goal into 3-8 concrete subtasks. Return a JSON object with:
{
  "tasks": [
    {
      "id": "task_1",
      "title": "short title",
      "description": "what needs to be done",
      "dependencies": [],
      "estimatedComplexity": "low|medium|high"
    }
  ]
}

Dependencies should reference task IDs. Tasks with no dependencies can run in parallel.
Only output valid JSON, no explanation.

Goal: ${sanitizeForPrompt(goal.substring(0, 2000))}${contextBlock}`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Failed to parse task decomposition");
    }

    const parsed = JSON.parse(match[0]) as { tasks: Omit<SubTask, "status">[] };

    const tasks: SubTask[] = parsed.tasks.map((t) => ({
      ...t,
      status: "pending" as TaskStatus,
    }));

    // Validate DAG: no circular dependencies
    validateDAG(tasks);

    return {
      goal,
      tasks,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, goal: goal.substring(0, 100) }, "Goal decomposition failed");
    throw err;
  }
}

/**
 * Validate that the task graph is a DAG (no circular dependencies).
 * Throws if a cycle is detected.
 */
export function validateDAG(tasks: SubTask[]): void {
  const taskIds = new Set(tasks.map((t) => t.id));
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(taskId: string): void {
    if (visiting.has(taskId)) {
      throw new Error(`Circular dependency detected involving task: ${taskId}`);
    }
    if (visited.has(taskId)) return;

    visiting.add(taskId);
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          throw new Error(`Task ${taskId} depends on non-existent task: ${dep}`);
        }
        visit(dep);
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) {
    visit(task.id);
  }
}

/**
 * Get tasks that are ready to execute (all dependencies completed).
 */
export function getReadyTasks(dag: TaskDAG): SubTask[] {
  const completedIds = new Set(
    dag.tasks.filter((t) => t.status === "completed").map((t) => t.id)
  );

  return dag.tasks.filter((task) => {
    if (task.status !== "pending") return false;
    return task.dependencies.every((dep) => completedIds.has(dep));
  });
}

/**
 * Update task status in the DAG. Returns updated DAG.
 */
export function updateTaskStatus(
  dag: TaskDAG,
  taskId: string,
  status: TaskStatus,
  output?: string,
  error?: string,
): TaskDAG {
  const tasks = dag.tasks.map((t) => {
    if (t.id !== taskId) return t;
    return { ...t, status, output, error };
  });

  // If a task failed, mark dependent tasks as blocked
  if (status === "failed") {
    const failedId = taskId;
    for (const task of tasks) {
      if (task.dependencies.includes(failedId) && task.status === "pending") {
        task.status = "blocked";
      }
    }
  }

  return { ...dag, tasks };
}

/**
 * Check if the entire DAG is complete (all tasks completed or failed/blocked).
 */
export function isDAGComplete(dag: TaskDAG): boolean {
  return dag.tasks.every(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "blocked"
  );
}

/**
 * Get execution order: topological sort of the DAG.
 */
export function getExecutionOrder(dag: TaskDAG): SubTask[][] {
  const levels: SubTask[][] = [];
  const completed = new Set<string>();
  const remaining = new Set(dag.tasks.map((t) => t.id));

  while (remaining.size > 0) {
    const level: SubTask[] = [];

    for (const task of dag.tasks) {
      if (!remaining.has(task.id)) continue;
      if (task.dependencies.every((dep) => completed.has(dep))) {
        level.push(task);
      }
    }

    if (level.length === 0) {
      // Remaining tasks have unresolvable dependencies
      break;
    }

    for (const task of level) {
      remaining.delete(task.id);
      completed.add(task.id);
    }

    levels.push(level);
  }

  return levels;
}

// ─── Monte Carlo Thought Trees (MCTS) ────────────────────────────────────────

export interface MCTSBranch {
  id: string;
  reasoning: string;
  score: number;
  pruned: boolean;
}

export interface MCTSResult {
  bestBranch: MCTSBranch;
  branches: MCTSBranch[];
  exploredCount: number;
  prunedCount: number;
}

const MCTS_PRUNE_THRESHOLD = 0.4; // prune branches with ML score below this

/**
 * Monte Carlo Thought Trees: generate N parallel reasoning branches for a
 * problem, score each branch via ML cosine similarity against an ideal
 * reference embedding, prune low-quality branches, then return the best.
 *
 * @param problem   The question or goal to reason about
 * @param branches  Number of parallel branches to simulate (default 5)
 * @param context   Optional prior context fed to each branch
 */
export async function runMCTS(
  problem: string,
  branches = 5,
  context?: string
): Promise<MCTSResult> {
  const contextBlock = context ? `\nContext: ${sanitizeForPrompt(context.substring(0, 1500))}` : "";

  // ── Step 1: Generate an ideal reference answer (anchor for scoring) ────
  let referenceText: string;
  try {
    const ref = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Give the single most accurate and complete answer to the following in 2–3 sentences:\n\n${sanitizeForPrompt(problem.substring(0, 2000))}${contextBlock}`,
        },
      ],
      temperature: 0,
    });
    referenceText = ref.text;
  } catch (err) {
    logger.error({ err, problem: problem.substring(0, 100) }, "MCTS: reference answer generation failed");
    throw err;
  }

  // ── Step 2: Generate N diverse reasoning branches in parallel ──────────
  const branchPromises = Array.from({ length: branches }, (_, i) =>
    routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "system",
          content: `You are reasoning branch #${i + 1}. Approach the problem from a distinct angle: ${
            ["logical", "empirical", "creative", "critical", "intuitive"][i % 5]
          } reasoning.`,
        },
        {
          role: "user",
          content: `Reason through the following problem step-by-step and give your best answer:\n\n${sanitizeForPrompt(problem.substring(0, 2000))}${contextBlock}`,
        },
      ],
      temperature: 0.7 + i * 0.05, // slight temperature spread for diversity
    }).catch((err) => {
      logger.warn({ err, branch: i }, "MCTS: branch generation failed");
      return null;
    })
  );

  const branchResponses = await Promise.all(branchPromises);

  // ── Step 3: Score each branch via ML cosine similarity vs. reference ───
  const scoredBranches: MCTSBranch[] = [];
  const scorePromises = branchResponses.map(async (resp, i) => {
    if (!resp) return;
    let score;
    try {
      score = await mlWorker.computeSimilarity(resp.text, referenceText);
    } catch {
      // Fallback: Jaccard on token overlap
      const tokenize = (s: string) =>
        new Set(s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter((w) => w.length > 2));
      const a = tokenize(resp.text);
      const b = tokenize(referenceText);
      let overlap = 0;
      for (const w of a) { if (b.has(w)) overlap++; }
      const union = new Set([...a, ...b]).size;
      score = union > 0 ? overlap / union : 0;
    }
    scoredBranches.push({
      id: `branch_${i + 1}`,
      reasoning: resp.text,
      score,
      pruned: score < MCTS_PRUNE_THRESHOLD,
    });
  });

  await Promise.all(scorePromises);

  // Sort descending by score
  scoredBranches.sort((a, b) => b.score - a.score);

  const surviving = scoredBranches.filter((b) => !b.pruned);
  const prunedCount = scoredBranches.length - surviving.length;

  if (scoredBranches.length === 0) {
    throw new Error("MCTS failed: all reasoning branches failed to generate");
  }

  const bestBranch = surviving.length > 0 ? surviving[0] : scoredBranches[0];

  logger.info(
    {
      problem: problem.substring(0, 80),
      explored: scoredBranches.length,
      pruned: prunedCount,
      bestScore: bestBranch?.score.toFixed(3),
    },
    "MCTS complete"
  );

  return {
    bestBranch,
    branches: scoredBranches,
    exploredCount: scoredBranches.length,
    prunedCount,
  };
}
