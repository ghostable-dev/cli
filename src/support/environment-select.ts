import { select } from '@inquirer/prompts';

import { log } from './logger.js';
import { promptWithCancel } from './prompts.js';

export async function resolveEnvironmentChoice(
	envNames: string[],
	provided?: string,
	message = 'Select an environment:',
): Promise<string> {
	const trimmed = provided?.trim();
	if (trimmed) {
		return trimmed;
	}

	if (!envNames.length) {
		log.error('❌ No environments found in the manifest.');
		process.exit(1);
	}

	const choices = envNames
		.slice()
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, value: name }));

	return promptWithCancel(() =>
		select<string>({
			message,
			choices,
		}),
	);
}
