import { Command } from "commander";
import chalk from "chalk";
import { getConfig } from "../lib/config.js";

export const configCommand = new Command("config")
  .description("Manage CLI configuration");

configCommand
  .command("set <key> <value>")
  .description("Set a config value")
  .action((key: string, value: string) => {
    const config = getConfig();
    const validKeys = ["serverUrl", "defaultPersona", "outputFormat"];
    if (!validKeys.includes(key)) {
      console.log(chalk.red(`Invalid key. Valid keys: ${validKeys.join(", ")}`));
      process.exit(1);
    }
    config.set(key, value);
    console.log(chalk.green(`${key} = ${value}`));
  });

configCommand
  .command("get <key>")
  .description("Get a config value")
  .action((key: string) => {
    const config = getConfig();
    const value = config.get(key);
    if (value !== undefined) {
      console.log(`${key} = ${value}`);
    } else {
      console.log(chalk.yellow(`${key} is not set`));
    }
  });

configCommand
  .command("list")
  .description("Show all config values")
  .action(() => {
    const config = getConfig();
    const store = config.store as Record<string, unknown>;
    console.log(chalk.bold("Configuration:\n"));
    for (const [key, value] of Object.entries(store)) {
      if (key === "token") {
        console.log(`  ${key} = ${value ? chalk.green("[set]") : chalk.dim("[not set]")}`);
      } else {
        console.log(`  ${key} = ${value}`);
      }
    }
  });

configCommand
  .command("reset")
  .description("Reset all config to defaults")
  .action(() => {
    const config = getConfig();
    config.clear();
    console.log(chalk.green("Configuration reset to defaults."));
  });
