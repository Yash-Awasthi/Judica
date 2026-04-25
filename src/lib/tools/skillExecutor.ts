import { db } from "../drizzle.js";
import { userSkills } from "../../db/schema/marketplace.js";
import { eq, and } from "drizzle-orm";
import logger from "../logger.js";
import { registerTool, type ToolExecutionContext } from "./index.js";
import { executePython } from "../../sandbox/pythonSandbox.js";

const MAX_SKILL_CODE_SIZE = 102_400; // 100KB
const MAX_INPUT_VALUE_SIZE = 51_200; // 50KB per value

/**
 * Execute a user-defined skill by name.
 * Loads the skill from DB, injects inputs as Python variables,
 * runs via child_process with a 10s timeout, and parses stdout as JSON.
 */
export async function executeUserSkill(
  userId: number | string,
  skillName: string,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const numericUserId = typeof userId === "string" ? Number(userId) : userId;
  const [skill] = await db
    .select()
    .from(userSkills)
    .where(
      and(
        eq(userSkills.userId, numericUserId),
        eq(userSkills.name, skillName),
        eq(userSkills.active, true)
      )
    )
    .limit(1);

  if (!skill) {
    throw new Error(`Skill "${skillName}" not found or inactive`);
  }

  return runSkillCode(skill.code, inputs, String(userId), skillName);
}

function runSkillCode(
  code: string,
  inputs: Record<string, unknown>,
  userId: string | number,
  skillName: string
): Promise<unknown> {
  if (code.length > MAX_SKILL_CODE_SIZE) {
    throw new Error(`Skill code exceeds maximum size (${MAX_SKILL_CODE_SIZE} chars)`);
  }

  // Build Python script: inject inputs as variables, then append skill code
  const inputLines = Object.entries(inputs)
    .map(([key, value]) => {
      const safeKey = key.replace(/[^a-zA-Z0-9_]/g, "_");
      const serializedValue = JSON.stringify(value);
      if (serializedValue.length > MAX_INPUT_VALUE_SIZE) {
        throw new Error(`Input "${key}" exceeds maximum size (${MAX_INPUT_VALUE_SIZE} chars)`);
      }
      return `${safeKey} = ${serializedValue}`;
    })
    .join("\n");

  const script = `import json, sys
${inputLines}

${code}
`;

  logger.info(
    { userId, skillName, inputKeys: Object.keys(inputs) },
    "Executing user skill"
  );

  return executePython(script, 10_000).then((result) => {
    if (result.error) {
      throw new Error(`Skill execution failed: ${result.error}`);
    }
    const trimmed = result.output.join("\n").trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  });
}

/**
 * Register a dynamic "user_skill" tool in the tool registry.
 * When called, it looks up the skill by name from the calling user's skills
 * and executes it.
 */
export function registerUserSkillsAsTools(): void {
  registerTool(
    {
      name: "user_skill",
      description: "Execute a custom user-defined Python skill by name. The skill must be created and active in the user's skill library.",
      parameters: {
        type: "object",
        properties: {
          skill_name: { type: "string", description: "The name of the user skill to execute" },
          inputs: { type: "string", description: "JSON string of input parameters for the skill" },
        },
        required: ["skill_name"],
      },
    },
    async (args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> => {
      const skillName = args.skill_name as string;
      const userId = context?.userId;
      if (!userId) {
        return JSON.stringify({ error: "User authentication required to execute skills" });
      }

      let inputs: Record<string, unknown> = {};
      if (args.inputs) {
        try {
          inputs = typeof args.inputs === "string" ? JSON.parse(args.inputs) : (args.inputs as Record<string, unknown>);
        } catch {
          return JSON.stringify({ error: "Invalid inputs JSON" });
        }
      }

      try {
        const result = await executeUserSkill(userId, skillName, inputs);
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ error: (err as Error).message });
      }
    }
  );
}
