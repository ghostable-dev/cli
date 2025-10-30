import { Command } from 'commander';
import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '../services/GhostableClient.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import { finalizeAuthentication } from './auth/shared.js';
import { runBrowserAuthFlow } from './auth/browser-flow.js';

export function registerRegisterCommand(program: Command) {
	program
		.command('register')
		.description('Create a new Ghostable account')
		.action(async () => {
			const apiBase = config.apiBase;
			const session = new SessionService();
			const client = GhostableClient.unauthenticated(apiBase);

			let token: string | null = null;
			try {
				token = await runBrowserAuthFlow({
					handlers: {
						start: () => client.startBrowserRegistration(),
						poll: (ticket) => client.pollBrowserRegistration(ticket),
					},
					copy: {
						intro: 'We need to open your browser to create your Ghostable account.',
						open: '🌐 Opening Ghostable in your browser to continue…',
						manual: 'If the browser does not open automatically, visit:',
						waiting: 'Waiting for you to finish registration…',
						expired: 'Registration link expired. Please try again.',
						cancelled: 'Registration was cancelled.',
						success: 'Account created. Completing setup…',
					},
					unsupportedMessageSubstrings: ['Browser registration'],
				});
			} catch (error) {
				const message = toErrorMessage(error);
				if (message) {
					log.error(message);
				} else {
					log.error('Registration failed.');
				}
				process.exit(1);
			}

			if (!token) {
				log.error(
					'Browser registration is not available. Visit the Ghostable dashboard to create an account.',
				);
				process.exit(1);
			}

			try {
				await finalizeAuthentication(token, client, session);
			} catch (error) {
				log.error(toErrorMessage(error) || 'Registration failed');
				process.exit(1);
			}
		});
}
