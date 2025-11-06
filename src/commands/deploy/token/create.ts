import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { input } from '@inquirer/prompts';
import ora from 'ora';

import boxen from 'boxen';
import chalk from 'chalk';

import { log } from '../../../support/logger.js';
import { toErrorMessage } from '../../../support/errors.js';
import {
	requireAuthedClient,
	requireDeviceIdentity,
	requireProjectContext,
	reshareEnvironmentKey,
	selectEnvironment,
} from './common.js';

import { KeyService, MemoryKeyStore } from '@/crypto';

export function configureCreateCommand(parent: Command) {
	parent
		.command('create')
		.description('Create a new deployment token and X25519 keypair.')
		.option('--env <ENV>', 'Environment name or ID to target')
		.option('--name <NAME>', 'Token display name')
		.option('--out <FILE>', 'Write the private key to a file instead of stdout')
		.action(async (options: { env?: string; name?: string; out?: string }) => {
			const { projectId } = await requireProjectContext();
			const client = await requireAuthedClient();
			const environment = await selectEnvironment(client, projectId, options.env);

			const tokenName =
				options.name?.trim() ||
				(
					await input({
						message: 'Token name (shown in Ghostable dashboard)',
						default: `${environment.name}-ci`,
					})
				).trim();

			if (!tokenName) {
				log.error('❌ Token name is required.');
				process.exit(1);
			}

			KeyService.initialize(new MemoryKeyStore());

			const spinner = ora('Minting deployment keypair…').start();
			let privateKeyB64 = '';
			try {
				const identity = await KeyService.createDeviceIdentity(
					tokenName,
					'deployment-token',
				);
				privateKeyB64 = identity.encryptionKey.privateKey;

				spinner.text = 'Registering deployment token…';
				const created = await client.createDeployToken(projectId, {
					environmentId: environment.id,
					name: tokenName,
					publicKey: identity.encryptionKey.publicKey,
				});

				spinner.text = 'Updating environment key shares…';
				const deviceIdentity = await requireDeviceIdentity();
				await reshareEnvironmentKey({
					client,
					projectId,
					envId: environment.id,
					envName: environment.name,
					identity: deviceIdentity,
					extraDeployTokens: [created.token],
				});

				spinner.succeed('Deployment token created.');

				const baseBoxOptions = {
					padding: { top: 1, bottom: 1, left: 2, right: 2 },
					margin: { top: 1, bottom: 1, left: 0, right: 0 },
					borderStyle: 'round' as const,
				};

				log.text(
					boxen(
						[`Token ID: ${created.token.id}`, `Environment: ${environment.name}`].join(
							'\n',
						),
						{
							...baseBoxOptions,
							borderColor: 'green' as const,
							title: chalk.bold('Deployment Token Created'),
							titleAlignment: 'center',
						},
					),
				);

				const apiTokenPlainText = created.apiToken?.plainText ?? created.secret;
				if (apiTokenPlainText) {
					const apiTokenLines = [
						'Add this one-time API token to your CI as GHOSTABLE_CI_TOKEN.',
						'',
						apiTokenPlainText,
					];

					if (created.apiToken?.tokenSuffix) {
						apiTokenLines.push(
							'',
							`Token suffix (for reference in the dashboard): ${created.apiToken.tokenSuffix}`,
						);
					}

					if (created.apiToken?.expiresAt) {
						apiTokenLines.push(
							`API token expires at ${created.apiToken.expiresAt.toISOString()}`,
						);
					}

					apiTokenLines.push(
						'',
						'⚠️ Store this token securely — it cannot be retrieved again.',
					);

					log.text(
						boxen(apiTokenLines.join('\n'), {
							...baseBoxOptions,
							borderColor: 'yellow' as const,
							title: chalk.bold('API Token (One-Time)'),
							titleAlignment: 'center',
						}),
					);
				}

				if (options.out) {
					const resolved = path.resolve(options.out);
					fs.mkdirSync(path.dirname(resolved), { recursive: true });
					fs.writeFileSync(resolved, `${privateKeyB64}\n`, { mode: 0o600 });
					log.text(
						boxen(
							[
								`Private key written to: ${resolved}`,
								'',
								'Set GHOSTABLE_MASTER_SEED in your CI to the contents of this private key file.',
							].join('\n'),
							{
								...baseBoxOptions,
								borderColor: 'magenta' as const,
								title: chalk.bold('Deployment Private Key'),
								titleAlignment: 'center',
							},
						),
					);
				} else {
					log.text(
						boxen(
							[
								'Set GHOSTABLE_MASTER_SEED in your CI to this private key (Base64):',
								'',
								privateKeyB64,
							].join('\n'),
							{
								...baseBoxOptions,
								borderColor: 'magenta' as const,
								title: chalk.bold('Deployment Private Key'),
								titleAlignment: 'center',
							},
						),
					);
				}
			} catch (error) {
				spinner.fail('Failed to create deployment token.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}
