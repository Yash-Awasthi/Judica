import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getConfig } from "../lib/config.js";

export const authCommand = new Command("auth")
  .description("Authentication management");

authCommand
  .command("login")
  .description("Authenticate with the judica server")
  .option("-s, --server <url>", "Server URL")
  .option("-t, --token <token>", "API token (PAT)")
  .option("-u, --username <username>", "Username")
  .option("-p, --password <password>", "Password")
  .action(async (options) => {
    const config = getConfig();

    if (options.server) {
      config.set("serverUrl", options.server);
    }

    const serverUrl = config.get("serverUrl") as string;

    // Token-based auth (PAT)
    if (options.token) {
      config.set("token", options.token);
      console.log(chalk.green(`Authenticated with token at ${serverUrl}`));
      return;
    }

    // Username/password auth
    if (options.username && options.password) {
      const spinner = ora("Authenticating...").start();
      try {
        const resp = await fetch(`${serverUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: options.username, password: options.password }),
        });

        if (!resp.ok) {
          const error = await resp.json() as Record<string, string>;
          spinner.fail(error.error ?? "Authentication failed");
          process.exit(1);
        }

        const data = await resp.json() as { token: string };
        config.set("token", data.token);
        spinner.succeed("Authenticated successfully");
      } catch (err) {
        spinner.fail((err as Error).message);
        process.exit(1);
      }
      return;
    }

    // Interactive prompt
    const inquirer = await import("inquirer");
    const answers = await inquirer.default.prompt([
      { type: "input", name: "username", message: "Username:" },
      { type: "password", name: "password", message: "Password:" },
    ]);

    const spinner = ora("Authenticating...").start();
    try {
      const resp = await fetch(`${serverUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      });

      if (!resp.ok) {
        const error = await resp.json() as Record<string, string>;
        spinner.fail(error.error ?? "Authentication failed");
        process.exit(1);
      }

      const data = await resp.json() as { token: string };
      config.set("token", data.token);
      spinner.succeed("Authenticated successfully");
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });

authCommand
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    const config = getConfig();
    config.delete("token");
    console.log(chalk.green("Logged out. Token cleared."));
  });

authCommand
  .command("status")
  .description("Show authentication status")
  .action(() => {
    const config = getConfig();
    const token = config.get("token") as string;
    const serverUrl = config.get("serverUrl") as string;

    console.log(chalk.bold("Auth Status:\n"));
    console.log(`  Server:  ${serverUrl}`);
    console.log(`  Token:   ${token ? chalk.green("set") + chalk.dim(` (${token.slice(0, 8)}...)`) : chalk.red("not set")}`);
  });
