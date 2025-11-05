import { Command } from 'commander';
import { input, password } from '@inquirer/prompts';
import ora from 'ora';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { finalizeAuthentication } from '../auth/shared.js';
import { BrowserAuthFlowResult, runBrowserAuthFlow } from '../auth/browser-flow.js';

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
				const result: BrowserAuthFlowResult = await runBrowserAuthFlow({
					handlers: {
						start: () => client.startBrowserLogin(),
						poll: (ticket) => client.pollBrowserLogin(ticket),
					},
					copy: {
						intro: 'We need to open your browser to complete login.',
						open: '🌐 Opening Ghostable in your browser to authenticate…',
						manual: 'If the browser does not open automatically, visit:',
						waiting: 'Waiting for browser authentication…',
						expired: 'Authentication link expired. Please try again.',
						cancelled: 'Authentication was cancelled.',
						success: 'Authenticated.',
					},
					unsupportedMessageSubstrings: ['Browser login'],
				});
				if (result.kind === 'token') {
					token = result.token;
				} else if (result.kind === 'unsupported') {
					browserAttempted = false;
				}
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
				await finalizeAuthentication(token, client, session);
			} catch (error) {
				log.error(toErrorMessage(error) || 'Login failed');
				process.exit(1);
			}
		});
}
