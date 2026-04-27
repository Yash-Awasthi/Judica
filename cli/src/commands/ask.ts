import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ApiClient } from "../lib/api.js";

export const askCommand = new Command("ask")
  .description("Ask the AI a question")
  .argument("<question...>", "Your question")
  .option("-p, --persona <id>", "Persona/agent to use")
  .option("-j, --json", "Output as JSON")
  .action(async (questionParts: string[], options) => {
    const question = questionParts.join(" ");
    const spinner = ora("Thinking...").start();

    try {
      const api = new ApiClient();
      if (!api.isAuthenticated) {
        spinner.fail("Not authenticated. Run: judica auth login");
        process.exit(1);
      }

      const response = await api.post<{ answer: string; sources?: string[] }>("/api/ask", {
        message: question,
        personaId: options.persona,
      });

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.log(chalk.bold("\nAnswer:\n"));
        console.log(response.answer);
        if (response.sources?.length) {
          console.log(chalk.dim("\nSources:"));
          response.sources.forEach((s) => console.log(chalk.dim(`  - ${s}`)));
        }
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
