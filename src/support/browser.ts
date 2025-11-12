import { confirm } from '@inquirer/prompts';
import open from 'open';

import { log } from './logger.js';
import { promptWithCancel } from './prompts.js';
import { toErrorMessage } from './errors.js';

type OfferToOpenUrlOptions = {
	promptMessage?: string;
	openingMessage?: string;
};

const DEFAULT_PROMPT = 'Open this link in your browser now?';
const DEFAULT_OPENING_MESSAGE = '🌐 Opening in your default browser…';

export async function offerToOpenUrlInBrowser(
	url: string | undefined,
	options: OfferToOpenUrlOptions = {},
): Promise<void> {
	if (!url) return;
	if (!process.stdin.isTTY || !process.stdout.isTTY) return;

	const shouldOpen = await promptWithCancel(() =>
		confirm({
			message: options.promptMessage ?? DEFAULT_PROMPT,
			default: true,
		}),
	);

	if (!shouldOpen) return;

	log.info(options.openingMessage ?? DEFAULT_OPENING_MESSAGE);

	try {
		await open(url, { wait: false });
	} catch (error) {
		const message = toErrorMessage(error);
		if (message) {
			log.warn(`⚠️ Unable to automatically open the browser: ${message}`);
		} else {
			log.warn('⚠️ Unable to automatically open the browser.');
		}
	}
}
