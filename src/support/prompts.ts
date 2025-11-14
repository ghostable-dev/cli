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
