import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ApiClient } from "../lib/api.js";

export const historyCommand = new Command("history")
  .description("Show recent conversations")
  .option("-n, --limit <n>", "Number of conversations", "10")
  .option("-j, --json", "Output as JSON")
  .action(async (options) => {
    const spinner = ora("Loading history...").start();
    try {
      const api = new ApiClient();
      const data = await api.get<{
        conversations: Array<{
          id: string;
          title: string;
          messageCount: number;
          lastMessageAt: string;
          createdAt: string;
        }>;
      }>(`/api/history?limit=${options.limit}`);

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!data.conversations?.length) {
        console.log(chalk.yellow("No conversations found."));
        return;
      }

      console.log(chalk.bold("\nRecent Conversations:\n"));
      for (const c of data.conversations) {
        const date = new Date(c.lastMessageAt).toLocaleDateString();
        console.log(`  ${chalk.cyan(c.title || "Untitled")}`);
        console.log(`    ID: ${chalk.dim(c.id)}  Messages: ${c.messageCount}  Last: ${date}`);
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
