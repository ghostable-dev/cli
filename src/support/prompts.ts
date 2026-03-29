import readline from 'node:readline';

import { log } from './logger.js';

const EXIT_PROMPT_ERROR_NAME = 'ExitPromptError';

export const isPromptCanceledError = (error: unknown): error is Error & { name: string } =>
	typeof error === 'object' &&
	error !== null &&
	'name' in error &&
	(error as { name?: unknown }).name === EXIT_PROMPT_ERROR_NAME;

export async function promptWithCancel<T>(factory: () => Promise<T>): Promise<T> {
	try {
		return await factory();
	} catch (error) {
		if (isPromptCanceledError(error)) {
			log.warn('Prompt canceled.');
			process.exit(1);
		}
		throw error;
	}
}

export async function promptForMultilineInput(opts: {
	message: string;
	initialText?: string;
}): Promise<string | null> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error('Multiline input requires an interactive terminal.');
	}

	log.line();
	log.text(opts.message);
	log.text('Type `.save` on a new line to save, `.cancel` to abort, or press Ctrl+D to save.');

	if (opts.initialText?.trim().length) {
		log.line();
		log.text('Current value:');
		for (const line of opts.initialText.split('\n')) {
			log.text(`  ${line}`);
		}
		log.line();
		log.text('Enter the full replacement value below:');
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});

	return await new Promise<string | null>((resolve, reject) => {
		let settled = false;
		const lines: string[] = [];

		const finish = (value: string | null): void => {
			if (settled) {
				return;
			}

			settled = true;
			rl.close();
			resolve(value);
		};

		rl.setPrompt('> ');
		rl.prompt();

		rl.on('line', (line) => {
			if (line === '.save') {
				finish(lines.join('\n'));
				return;
			}

			if (line === '.cancel') {
				finish(null);
				return;
			}

			lines.push(line);
			rl.prompt();
		});

		rl.on('SIGINT', () => {
			if (settled) {
				return;
			}

			settled = true;
			rl.close();
			reject(Object.assign(new Error('Prompt canceled.'), { name: EXIT_PROMPT_ERROR_NAME }));
		});

		rl.on('close', () => {
			if (settled) {
				return;
			}

			settled = true;
			resolve(lines.join('\n'));
		});
	});
}
