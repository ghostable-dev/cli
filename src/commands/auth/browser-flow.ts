import { input } from '@inquirer/prompts';
import ora from 'ora';
import open from 'open';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { HttpError } from '@/ghostable';
import type { BrowserLoginSession, BrowserLoginStatus } from '@/ghostable';

const BROWSER_UNAVAILABLE_STATUSES = [404, 405, 409, 410, 422, 501];
const MIN_BROWSER_POLL_INTERVAL_MS = 1_000;

function parseExpiry(value?: string): number | null {
	if (!value) return null;
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export type BrowserFlowHandlers = {
	start: () => Promise<BrowserLoginSession>;
	poll: (ticket: string) => Promise<BrowserLoginStatus>;
};

export type BrowserFlowCopy = {
	intro: string;
	open: string;
	manual: string;
	waiting: string;
	expired: string;
	cancelled: string;
	success: string;
	verificationRequired?: string;
};

export type BrowserAuthFlowResult =
	| { kind: 'token'; token: string }
	| { kind: 'unsupported' }
	| { kind: 'expired' }
	| { kind: 'cancelled' }
	| { kind: 'verification_required' };

export type BrowserFlowOptions = {
	handlers: BrowserFlowHandlers;
	copy: BrowserFlowCopy;
	unsupportedMessageSubstrings?: string[];
};

const DEFAULT_VERIFICATION_MESSAGE =
	'Email verification required. Check your inbox, verify your address, and then sign in again from the CLI.';

export async function runBrowserAuthFlow(
	options: BrowserFlowOptions,
): Promise<BrowserAuthFlowResult> {
	const { handlers, copy, unsupportedMessageSubstrings = [] } = options;

	let session: BrowserLoginSession;
	try {
		session = await handlers.start();
	} catch (error) {
		if (error instanceof HttpError && BROWSER_UNAVAILABLE_STATUSES.includes(error.status)) {
			return { kind: 'unsupported' };
		}
		if (
			error instanceof Error &&
			unsupportedMessageSubstrings.some((text) => error.message.includes(text))
		) {
			return { kind: 'unsupported' };
		}
		throw error;
	}

	log.info(copy.intro);
	await input({ message: 'Press ENTER to continue...', default: '' });
	log.info(copy.open);
	try {
		await open(session.loginUrl, { wait: false });
	} catch (error) {
		const message = toErrorMessage(error);
		if (message) {
			log.warn(`⚠️ Unable to automatically open the browser: ${message}`);
		} else {
			log.warn('⚠️ Unable to automatically open the browser.');
		}
	}
	log.info(`${copy.manual}\n${session.loginUrl}`);

	const spinner = ora(copy.waiting).start();
	const pollIntervalMs = Math.max(
		MIN_BROWSER_POLL_INTERVAL_MS,
		Math.round((session.pollIntervalSeconds ?? 2) * 1_000),
	);
	const expiresAt = parseExpiry(session.expiresAt);

	while (true) {
		if (expiresAt && Date.now() >= expiresAt) {
			spinner.fail(copy.expired);
			return { kind: 'expired' };
		}

		await delay(pollIntervalMs);

		try {
			const status = await handlers.poll(session.ticket);
			if (status.token) {
				spinner.succeed(copy.success);
				return { kind: 'token', token: status.token };
			}
			if (status.status && status.status !== 'pending') {
				if (
					status.status === 'verification_required' ||
					(status.status === 'approved' && !status.token)
				) {
					spinner.info(copy.verificationRequired ?? DEFAULT_VERIFICATION_MESSAGE);
					return { kind: 'verification_required' };
				}

				if (status.status === 'expired') {
					spinner.fail(copy.expired);
					return { kind: 'expired' };
				}

				spinner.fail(copy.cancelled);
				return { kind: 'cancelled' };
			}
		} catch (error) {
			spinner.fail(toErrorMessage(error) || 'Authentication failed');
			throw error;
		}
	}
}
