import { chromium } from "playwright";
import logger from "../logger.js";
import path from "path";
import fs from "fs";

/**
 * Utility to help users perform a manual login to RPA targets.
 * Launches a visible browser, waits for user to sign in, 
 * then saves the storage state (session/cookies) to disk.
 */
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

  // Load existing session if available for session refresh/extension
  const context = fs.existsSync(sessionFile) 
    ? await browser.newContext({ storageState: sessionFile })
    : await browser.newContext();

  const page = await context.newPage();
  await page.goto(url);

  console.log("\n---------------------------------------------------------");
  console.log(`PLEASE LOG IN MANUALLY TO ${targetName.toUpperCase()}`);
  console.log("---------------------------------------------------------");
  console.log("1. Perform the sign-in / verification process in the browser window.");
  console.log("2. Once you are fully logged in and see the chat interface,");
  console.log("3. Return to this terminal and press ENTER to save the session.");
  console.log("---------------------------------------------------------\n");

  // Wait for user input in terminal
  await new Promise((resolve) => process.stdin.once("data", resolve));

  logger.info({ sessionFile }, "Saving storage state...");
  await context.storageState({ path: sessionFile });
  
  logger.info("Session saved successfully. You can now close the browser.");
  
  await browser.close();
}

/**
 * CLI support for running the helper directly
 * Example: tsx src/lib/tools/login_helper.ts --target chatgpt
 */
if (process.argv[1]?.includes("login_helper.ts")) {
  const target = process.argv.slice(2).find(arg => !arg.startsWith("--")) as any;
  if (target) {
    runLoginHelper(target).catch(console.error);
  } else {
    console.log("Usage: tsx src/lib/tools/login_helper.ts <chatgpt|claude|deepseek|gemini>");
    process.exit(1);
  }
}
