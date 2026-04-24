import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ApiClient } from "../lib/api.js";

export const searchCommand = new Command("search")
  .description("Search the knowledge base")
  .argument("<query...>", "Search query")
  .option("-n, --limit <n>", "Max results", "10")
  .option("-j, --json", "Output as JSON")
  .action(async (queryParts: string[], options) => {
    const query = queryParts.join(" ");
    const spinner = ora("Searching...").start();

    try {
      const api = new ApiClient();
      const results = await api.post<{
        results: Array<{ title: string; content: string; source: string; score: number }>;
      }>("/api/kb/search", {
        query,
        limit: Number(options.limit),
      });

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.results.length === 0) {
          console.log(chalk.yellow("No results found."));
          return;
        }
        console.log(chalk.bold(`\n${results.results.length} results:\n`));
        results.results.forEach((r, i) => {
          console.log(chalk.cyan(`${i + 1}. ${r.title}`));
          console.log(chalk.dim(`   Source: ${r.source}`));
          console.log(`   ${r.content.slice(0, 200)}${r.content.length > 200 ? "..." : ""}`);
          console.log();
        });
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
