#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { registerAllCommands } from './commands/_autoregister.js';
import { log } from './support/logger.js';

const program = new Command();
program.name('ghostable').description('Ghostable zero-knowledge CLI (experimental)');
program.version('v2.0.0');
await registerAllCommands(program);

// Helpful defaults
program.showHelpAfterError();
program.configureOutput({
	outputError: (str) => process.stderr.write(chalk.red(str)),
});

program.parseAsync(process.argv).catch((err) => {
	// Catch any import-time or action-time errors so they don’t crash silently
	log.error(err?.stack || String(err));
	process.exit(1);
});
