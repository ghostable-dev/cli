import { Command } from 'commander';
import { input, password, select } from '@inquirer/prompts';
import ora from 'ora';
import open from 'open';
import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient, type BrowserLoginSession } from '../services/GhostableClient.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import { linkDeviceFlow } from './device/index.js';
import { HttpError } from '../http/errors.js';

const MIN_BROWSER_POLL_INTERVAL_MS = 1_000;

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseExpiry(value?: string): number | null {
	if (!value) return null;
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
}

async function attemptBrowserLogin(client: GhostableClient): Promise<string | null> {
	let session: BrowserLoginSession;
	try {
		session = await client.startBrowserLogin();
	} catch (error) {
		if (error instanceof HttpError && [404, 405, 409, 410, 422, 501].includes(error.status)) {
			return null;
		}
		if (error instanceof Error && error.message.includes('Browser login')) {
			return null;
		}
		throw error;
	}

	log.info('We need to open your browser to complete login.');
	await input({ message: 'Press ENTER to continue...', default: '' });
	log.info('🌐 Opening Ghostable in your browser to authenticate…');
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
	log.info(`If the browser does not open automatically, visit:
${session.loginUrl}`);

	const spinner = ora('Waiting for browser authentication…').start();
	const pollIntervalMs = Math.max(
		MIN_BROWSER_POLL_INTERVAL_MS,
		Math.round((session.pollIntervalSeconds ?? 2) * 1_000),
	);
	const expiresAt = parseExpiry(session.expiresAt);

	while (true) {
		if (expiresAt && Date.now() >= expiresAt) {
			spinner.fail('Authentication link expired. Please try again.');
			return null;
		}

		await delay(pollIntervalMs);

		try {
			const status = await client.pollBrowserLogin(session.ticket);
			if (status.token) {
				spinner.succeed('Authenticated.');
				return status.token;
			}
			if (status.status && status.status !== 'pending') {
				const message =
					status.status === 'expired'
						? 'Authentication link expired. Please try again.'
						: 'Authentication was cancelled.';
				spinner.fail(message);
				return null;
			}
		} catch (error) {
			spinner.fail(toErrorMessage(error) || 'Authentication failed');
			throw error;
		}
	}
}

async function passwordLoginFlow(client: GhostableClient, apiBase: string): Promise<string> {
	const email = await input({
		message: 'Email:',
		validate: (v) => v.includes('@') || 'Enter a valid email',
	});
	const pwd = await password({ message: 'Password:' });

	const spinner = ora('Authenticating…').start();

	try {
		let token = await client.login(email, pwd);
		if (!token) {
			spinner.stop();
			const code = await password({
				message: '2FA code:',
			});
			spinner.start('Verifying 2FA…');
			const twofaClient = GhostableClient.unauthenticated(apiBase);
			token = await twofaClient.login(email, pwd, code);
		}
		spinner.succeed('Authenticated.');
		return token;
	} catch (error) {
		spinner.fail(toErrorMessage(error) || 'Login failed');
		throw error;
	}
}

async function completeLogin(
	token: string,
	client: GhostableClient,
	session: SessionService,
): Promise<void> {
	const authed = client.withToken(token);
	const orgs = await authed.organizations();

	let organizationId: string | undefined;
	if (orgs.length === 1) {
		organizationId = orgs[0].id;
		log.ok(`✅ Using organization: ${orgs[0].label()}`);
	} else if (orgs.length > 1) {
		organizationId = await select({
			message: 'Choose your organization',
			choices: orgs.map((o) => ({
				name: o.label(),
				value: o.id,
			})),
		});
		log.ok(`✅ Using organization: ${orgs.find((o) => o.id === organizationId)?.label()}`);
	} else {
		log.warn('No organizations found. Create one in the dashboard.');
	}

	await session.save({ accessToken: token, organizationId });
	log.ok('✅ Session stored in OS keychain.');

	try {
		await linkDeviceFlow(authed);
	} catch (deviceError) {
		log.warn(
			`⚠️ Device provisioning skipped: ${toErrorMessage(deviceError) ?? String(deviceError)}`,
		);
	}
}

export function registerLoginCommand(program: Command) {
	program
		.command('login')
		.description('Authenticate with Ghostable')
		.action(async () => {
			const apiBase = config.apiBase;
			const session = new SessionService();
			const client = GhostableClient.unauthenticated(apiBase);
			let token: string | null = null;
			let browserAttempted = false;

			try {
				browserAttempted = true;
				token = await attemptBrowserLogin(client);
			} catch (error) {
				browserAttempted = true;
				log.warn('⚠️ Browser login failed. Falling back to email/password prompts.');
				const message = toErrorMessage(error);
				if (message) log.warn(message);
			}

			if (!token) {
				if (browserAttempted) {
					log.info('Falling back to email/password prompts.');
				}

				try {
					token = await passwordLoginFlow(client, apiBase);
				} catch (error) {
					const message = toErrorMessage(error);
					if (message) log.error(message);
					process.exit(1);
				}
			}

			if (!token) {
				log.error('Login failed.');
				process.exit(1);
			}

			try {
				await completeLogin(token, client, session);
			} catch (error) {
				log.error(toErrorMessage(error) || 'Login failed');
				process.exit(1);
			}
		});
}
