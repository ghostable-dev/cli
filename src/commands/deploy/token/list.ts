import { Command } from 'commander';

import { log } from '../../../support/logger.js';
import { toErrorMessage } from '../../../support/errors.js';
import { formatDateTime } from '../../../support/dates.js';
import { requireAuthedClient, requireProjectContext, selectEnvironment } from './common.js';
import type { DeploymentToken } from '@/entities';

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
				tokens = await client.listDeployTokens(projectId, environment.name);
			} catch (error) {
				log.error(`❌ Failed to load deployment tokens: ${toErrorMessage(error)}`);
				process.exit(1);
			}

			if (!tokens.length) {
				log.warn(`No deployment tokens found for ${environment.name}.`);
				return;
			}

			renderTable(tokens);
		});

	function renderTable(tokens: DeploymentToken[]): void {
		const keyed = Object.fromEntries(
			tokens.map((token) => [
				token.id,
				{
					Name: token.name,
					Status: token.status,
					'Last Used': token.lastUsedAt ? formatDateTime(token.lastUsedAt) : 'never',
					Created: formatDateTime(token.createdAt),
				},
			]),
		);

		console.table(keyed);
	}
}
