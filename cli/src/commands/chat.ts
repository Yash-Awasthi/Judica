import { Command } from "commander";
import chalk from "chalk";
import * as readline from "node:readline";
import { ApiClient } from "../lib/api.js";

export const chatCommand = new Command("chat")
  .description("Start an interactive chat session")
  .option("-p, --persona <id>", "Persona/agent to use")
  .action(async (options) => {
    const api = new ApiClient();
    if (!api.isAuthenticated) {
      console.log(chalk.red("Not authenticated. Run: aibyai auth login"));
      process.exit(1);
    }

    console.log(chalk.bold("aibyai Interactive Chat"));
    console.log(chalk.dim("Type your message and press Enter. Type 'exit' or Ctrl+C to quit.\n"));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.green("you> "),
    });

    const conversationId = `cli-${Date.now()}`;

    rl.prompt();

    rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) { rl.prompt(); return; }
      if (input === "exit" || input === "quit") { rl.close(); return; }

      try {
        process.stdout.write(chalk.cyan("ai> "));
        const response = await api.post<{ answer: string }>("/api/ask", {
          message: input,
          conversationId,
          personaId: options.persona,
        });
        console.log(response.answer);
        console.log();
      } catch (err) {
        console.log(chalk.red(`Error: ${(err as Error).message}`));
      }

      rl.prompt();
    });

    rl.on("close", () => {
      console.log(chalk.dim("\nGoodbye!"));
      process.exit(0);
    });
  });
