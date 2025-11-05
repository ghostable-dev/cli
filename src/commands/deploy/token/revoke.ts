import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import ora from 'ora';

import { log } from '../../../support/logger.js';
import { toErrorMessage } from '../../../support/errors.js';
import {
	requireAuthedClient,
	requireDeviceIdentity,
	requireProjectContext,
	reshareEnvironmentKey,
	selectEnvironment,
} from './common.js';

import { formatDeploymentTokenLabel, isDeploymentTokenActive } from '@/entities';

export function configureRevokeCommand(parent: Command) {
	parent
		.command('revoke')
		.description('Revoke an existing deployment token and reshare KEKs.')
		.option('--env <ENV>', 'Environment name or ID that owns the token')
		.option('--token <ID>', 'Deployment token ID to revoke')
		.action(async (options: { env?: string; token?: string }) => {
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

			const active = tokens.filter(isDeploymentTokenActive);
			if (!active.length) {
				log.error(`❌ No active deployment tokens for ${environment.name}.`);
				process.exit(1);
			}

			let target = options.token
				? active.find((token) => token.id === options.token)
				: undefined;

			if (!target) {
				const choice = await select<string>({
					message: 'Select a deployment token to revoke',
					choices: active.map((token) => ({
						name: formatDeploymentTokenLabel(token),
						value: token.id,
					})),
				});
				target = active.find((token) => token.id === choice);
			}

			if (!target) {
				log.error('❌ Deployment token not found.');
				process.exit(1);
			}

			const spinner = ora('Revoking deployment token…').start();
			try {
				await client.revokeDeployToken(projectId, target.id);
				spinner.text = 'Re-encrypting environment key for remaining identities…';
				const deviceIdentity = await requireDeviceIdentity();
				await reshareEnvironmentKey({
					client,
					projectId,
					envId: environment.id,
					envName: environment.name,
					identity: deviceIdentity,
				});
				spinner.succeed('Deployment token revoked.');
				log.ok(`🛑 Revoked token ${target.id}`);
			} catch (error) {
				spinner.fail('Failed to revoke deployment token.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}
