#!/usr/bin/env node
/**
 * aibyai CLI — interact with aibyai from the terminal.
 *
 * Commands:
 *   ask <question>       — Ask a question and get an AI response
 *   search <query>       — Search the knowledge base
 *   chat                 — Start an interactive chat session
 *   config               — Manage CLI configuration
 *   auth login            — Authenticate with server
 *   auth logout           — Clear stored credentials
 *   auth status           — Show auth status
 *   connectors list       — List configured connectors
 *   connectors sync <id>  — Trigger connector sync
 *   history               — Show recent conversations
 */

import { Command } from "commander";
import { askCommand } from "./commands/ask.js";
import { searchCommand } from "./commands/search.js";
import { chatCommand } from "./commands/chat.js";
import { configCommand } from "./commands/config.js";
import { authCommand } from "./commands/auth.js";
import { connectorsCommand } from "./commands/connectors.js";
import { historyCommand } from "./commands/history.js";

const program = new Command();

program
  .name("aibyai")
  .description("aibyai CLI — Multi-Agent Deliberative Intelligence Platform")
  .version("0.1.0");

program.addCommand(askCommand);
program.addCommand(searchCommand);
program.addCommand(chatCommand);
program.addCommand(configCommand);
program.addCommand(authCommand);
program.addCommand(connectorsCommand);
program.addCommand(historyCommand);

program.parse();
