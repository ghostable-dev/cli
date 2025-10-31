import { Command } from 'commander';

import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { requireAuthedClient, requireProjectContext, selectEnvironment } from './common.js';

export function configureListCommand(parent: Command) {
	parent
		.command('list')
		.description('List deployment tokens for a project environment.')
		.option('--env <ENV>', 'Environment name or ID to filter by')
		.action(async (options: { env?: string }) => {
			const { projectId } = await requireProjectContext();
			const client = await requireAuthedClient();
			const environment = await selectEnvironment(client, projectId, options.env);

			let tokens;
			try {
				tokens = await client.listDeployTokens(projectId, environment.id);
			} catch (error) {
				log.error(`❌ Failed to load deployment tokens: ${toErrorMessage(error)}`);
				process.exit(1);
			}

			if (!tokens.length) {
				log.warn(`No deployment tokens found for ${environment.name}.`);
				return;
			}

			const rows = tokens.map((token) => ({
				ID: token.id,
				Name: token.name,
				Environment: token.environmentName,
				Status: token.status,
				Fingerprint: token.fingerprint ?? '—',
				'Last used': token.lastUsedAt ? token.lastUsedAt.toISOString() : 'never',
				Created: token.createdAt.toISOString(),
			}));

			console.table(rows);
		});
}
