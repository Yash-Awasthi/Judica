import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

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
  const contextBlock = context ? `\nContext: ${context.substring(0, 2000)}` : "";

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

Goal: ${goal}${contextBlock}`,
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
    logger.error({ err, goal }, "Goal decomposition failed");
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
