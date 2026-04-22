import { chromium } from "playwright";
import logger from "../logger.js";
import path from "path";
import fs from "fs";

export async function runLoginHelper(targetName: "chatgpt" | "claude" | "deepseek" | "gemini") {
  const targets: Record<string, string> = {
    chatgpt: "https://chat.openai.com",
    claude: "https://claude.ai",
    deepseek: "https://chat.deepseek.com",
    gemini: "https://gemini.google.com"
  };

  const url = targets[targetName];
  if (!url) {
    throw new Error(`Unknown target: ${targetName}`);
  }

  const sessionDir = path.join(process.cwd(), "sessions");
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const sessionFile = path.join(sessionDir, `${targetName}.json`);

  logger.info({ target: targetName, url }, "Launching browser for manual login...");
  
  const browser = await chromium.launch({ 
    headless: false // MUST be false for user interaction
  });

  const context = fs.existsSync(sessionFile) 
    ? await browser.newContext({ storageState: sessionFile })
    : await browser.newContext();

  const page = await context.newPage();
  await page.goto(url);

  // eslint-disable-next-line no-console
  console.log(`\n---------------------------------------------------------\nPLEASE LOG IN MANUALLY TO ${targetName.toUpperCase()}\n---------------------------------------------------------\n1. Perform the sign-in / verification process in the browser window.\n2. Once you are fully logged in and see the chat interface,\n3. Return to this terminal and press ENTER to save the session.\n---------------------------------------------------------\n`);

  await new Promise((resolve) => process.stdin.once("data", resolve));

  logger.info({ sessionFile }, "Saving storage state...");
  await context.storageState({ path: sessionFile });
  // P19-10: Restrict session file permissions — contains sensitive auth tokens
  try { fs.chmodSync(sessionFile, 0o600); } catch { /* may fail on some OS */ }

  logger.info("Session saved successfully. You can now close the browser.");
  
  await browser.close();
}

if (process.argv[1]?.includes("login_helper.ts")) {
  const target = process.argv.slice(2).find(arg => !arg.startsWith("--")) as "chatgpt" | "claude" | "deepseek" | "gemini" | undefined;
  if (target) {
    runLoginHelper(target).catch((err: unknown) => {
      logger.error({ err }, "Login helper failed");
      process.exit(1);
    });
  } else {
    // eslint-disable-next-line no-console
    console.log("Usage: tsx src/lib/tools/login_helper.ts <chatgpt|claude|deepseek|gemini>");
    process.exit(1);
  }
}
