import { execSync } from "child_process";
import prisma from "../db.js";
import logger from "../logger.js";

/**
 * Execute a user-defined skill by name.
 * Loads the skill from DB, injects inputs as Python variables,
 * runs via child_process with a 10s timeout, and parses stdout as JSON.
 */
export async function executeUserSkill(
  userId: string,
  skillName: string,
  inputs: Record<string, any>
): Promise<any> {
  const skill = await prisma.userSkill.findFirst({
    where: {
      userId,
      name: skillName,
      active: true,
    },
  });

  if (!skill) {
    throw new Error(`Skill "${skillName}" not found or inactive`);
  }

  // Build Python script: inject inputs as variables, then append skill code
  const inputLines = Object.entries(inputs)
    .map(([key, value]) => {
      const safeKey = key.replace(/[^a-zA-Z0-9_]/g, "_");
      return `${safeKey} = ${JSON.stringify(value)}`;
    })
    .join("\n");

  const script = `import json, sys
${inputLines}

${skill.code}
`;

  logger.info(
    { userId, skillName, inputKeys: Object.keys(inputs) },
    "Executing user skill"
  );

  try {
    const stdout = execSync(`python3 -c ${escapeShellArg(script)}`, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024, // 1MB
      encoding: "utf-8",
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });

    // Try to parse as JSON first, fall back to raw string
    const trimmed = stdout.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  } catch (err: any) {
    const message = err.stderr
      ? err.stderr.toString().trim()
      : err.message || "Skill execution failed";
    logger.error({ userId, skillName, error: message }, "Skill execution error");
    throw new Error(`Skill execution failed: ${message}`);
  }
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
