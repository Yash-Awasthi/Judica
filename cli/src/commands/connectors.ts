import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ApiClient } from "../lib/api.js";

export const connectorsCommand = new Command("connectors")
  .description("Manage data source connectors");

connectorsCommand
  .command("list")
  .description("List configured connectors")
  .option("-j, --json", "Output as JSON")
  .action(async (options) => {
    const spinner = ora("Loading connectors...").start();
    try {
      const api = new ApiClient();
      const data = await api.get<{
        connectors: Array<{ id: number; name: string; source: string; status: string; lastSync?: string }>;
      }>("/api/connectors");

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!data.connectors?.length) {
        console.log(chalk.yellow("No connectors configured."));
        return;
      }

      console.log(chalk.bold(`\n${data.connectors.length} connectors:\n`));
      for (const c of data.connectors) {
        const statusColor = c.status === "active" ? chalk.green : c.status === "error" ? chalk.red : chalk.yellow;
        console.log(`  ${chalk.cyan(c.name)} (${c.source})`);
        console.log(`    Status: ${statusColor(c.status)}  Last sync: ${c.lastSync ?? "never"}`);
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });

connectorsCommand
  .command("sync <id>")
  .description("Trigger a connector sync")
  .action(async (id: string) => {
    const spinner = ora(`Triggering sync for connector ${id}...`).start();
    try {
      const api = new ApiClient();
      await api.post(`/api/connectors/${id}/sync`);
      spinner.succeed("Sync triggered successfully");
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
