#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import type { Argument } from 'commander';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { registerAllCommands } from './commands/_autoregister.js';
import { log } from './support/logger.js';
import { isPromptCanceledError, promptWithCancel } from './support/prompts.js';

type InteractiveCommandConfig = {
	commandPath: string[];
	aliasSets?: string[][];
	label: string;
};

const INTERACTIVE_COMMANDS: InteractiveCommandConfig[] = [
	{
		commandPath: ['var'],
		aliasSets: [['var', 'variable']],
		label: '`ghostable var`',
	},
	{
		commandPath: ['device'],
		label: '`ghostable device`',
	},
	{
		commandPath: ['deploy'],
		label: '`ghostable deploy`',
	},
	{
		commandPath: ['env'],
		aliasSets: [['env', 'environment']],
		label: '`ghostable env`',
	},
	{
		commandPath: ['deploy', 'token'],
		label: '`ghostable deploy token`',
	},
	{
		commandPath: ['deploy-token'],
		label: '`ghostable deploy-token`',
	},
];

const humanReadableArgName = (arg: Argument): string => {
	const nameOutput = `${arg.name()}${arg.variadic ? '...' : ''}`;
	return arg.required ? `<${nameOutput}>` : `[${nameOutput}]`;
};

async function maybePromptInteractiveSubcommand(
	program: Command,
	rawArgs: string[],
): Promise<string[] | undefined> {
	const config = INTERACTIVE_COMMANDS.find((entry) => {
		const aliasSets = entry.aliasSets ?? entry.commandPath.map((segment) => [segment]);
		if (aliasSets.length !== rawArgs.length) return false;
		return aliasSets.every((aliases, idx) => aliases.includes(rawArgs[idx] ?? ''));
	});

	if (!config) {
		return undefined;
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return undefined;
	}

	let parent: Command | undefined = program;
	for (const segment of config.commandPath) {
		if (!parent) break;

		const nextCommand: Command | undefined = parent.commands.find(
			(cmd) => cmd.name() === segment,
		);
		if (!nextCommand) {
			parent = undefined;
			break;
		}
		parent = nextCommand;
	}

	if (!parent) return undefined;

	const subcommands = parent.commands
		.filter((cmd) => cmd.name() !== 'help' && !(cmd as Command & { _hidden?: boolean })._hidden)
		.sort((a, b) => a.name().localeCompare(b.name()));

	if (subcommands.length === 0) return undefined;

	log.line();
	log.text(`Available ${config.label} commands:`);
	for (const subcommand of subcommands) {
		const summary = subcommand.summary() || subcommand.description();
		const detail = summary ? ` - ${summary}` : '';
		log.text(`  - ${subcommand.name()}${detail}`);
	}
	log.line();

	const selected = await promptWithCancel(() =>
		select<string>({
			message: `Select a ${config.label} command to run`,
			choices: subcommands.map((subcommand) => {
				const summary = subcommand.summary() || subcommand.description();
				return {
					name: summary ? `${subcommand.name()} - ${summary}` : subcommand.name(),
					value: subcommand.name(),
				};
			}),
		}),
	);

	return [process.argv[0], process.argv[1], ...rawArgs, selected];
}

const program = new Command();
program.name('ghostable').description('Manage Ghostable environment secrets from the CLI');
program.version('v2.2.0');
await registerAllCommands(program);
program.configureHelp({
	subcommandTerm: (cmd) => {
		const args = cmd.registeredArguments
			.map((argument) => humanReadableArgName(argument))
			.join(' ');
		const options = cmd.options.length ? ' [options]' : '';
		return `${cmd.name()}${options}${args ? ` ${args}` : ''}`;
	},
});

// Helpful defaults
program.showHelpAfterError();
program.configureOutput({
	outputError: (str) => process.stderr.write(chalk.red(str)),
});

let forwardArgs: string[] | undefined;
let rawArgsForPrompt = process.argv.slice(2);
try {
	while (true) {
		const promptedArgs = await maybePromptInteractiveSubcommand(program, rawArgsForPrompt);
		if (!promptedArgs) break;

		forwardArgs = promptedArgs;
		rawArgsForPrompt = promptedArgs.slice(2);
	}
} catch (err) {
	if (isPromptCanceledError(err)) {
		log.warn('Canceled.');
		process.exit(1);
	}
	throw err;
}
const argvToParse = forwardArgs ?? process.argv;
if (forwardArgs) {
	process.argv = forwardArgs.slice();
}

program.parseAsync(argvToParse).catch((err) => {
	// Catch any import-time or action-time errors so they don’t crash silently
	log.error(err?.stack || String(err));
	process.exit(1);
});
