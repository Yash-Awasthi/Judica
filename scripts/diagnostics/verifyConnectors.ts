import { env } from "../src/config/env.js";
import { getDefaultMembers, getDefaultMaster } from "../src/services/council.service.js";

console.log("Checking environment and default council configuration...");

try {
  const members = getDefaultMembers(3);
  console.log("\n--- Default Members ---");
  members.forEach((m, i) => {
    console.log(`Member ${i+1}: ${m.name} (${m.model})`);
  });

  const master = getDefaultMaster();
  console.log("\n--- Default Master ---");
  console.log(`Master: ${master.name} (${master.model})`);

  console.log("\n--- API Key Checks ---");
  console.log(`OpenAI Key: ${env.OPENAI_API_KEY ? "SET" : "MISSING"}`);
  console.log(`Google Key: ${env.GOOGLE_API_KEY ? "SET" : "MISSING"}`);
  console.log(`Anthropic Key: ${env.ANTHROPIC_API_KEY ? "SET" : "MISSING"}`);

  console.log("\nConfiguration appears valid.");
} catch (error) {
  console.error("Error in configuration:", error);
}
