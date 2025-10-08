#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { registerAllCommands } from "./commands/_autoregister.js";

const program = new Command();
program.name("ghostable").description("Ghostable zero-knowledge CLI (experimental)").version("0.1.0");
await registerAllCommands(program);

// Helpful defaults
program.showHelpAfterError();
program.configureOutput({
  outputError: (str) => process.stderr.write(chalk.red(str)),
});

// If user runs bare `ghostable`, show help
if (process.argv.length <= 2) {
  program.outputHelp();
}

program.parseAsync(process.argv).catch((err) => {
  // Catch any import-time or action-time errors so they don’t crash silently
  console.error(chalk.red(err?.stack || String(err)));
  process.exit(1);
});