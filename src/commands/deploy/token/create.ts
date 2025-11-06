import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { input } from '@inquirer/prompts';
import ora from 'ora';
import boxen from 'boxen';
import chalk from 'chalk';

import { log } from '../../../support/logger.js';
import { toErrorMessage } from '../../../support/errors.js';
import { formatDateTimeWithRelative } from '../../../support/dates.js';
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
				log.line();

				const apiTokenPlainText = created.apiToken?.plainText ?? created.secret;
				const lines = [
					`${chalk.dim('Token ID:')} ${created.token.id}`,
					`${chalk.dim('Environment:')} ${environment.name}`,
					`${chalk.dim('Token Expires:')} ${
						created.apiToken?.expiresAt
							? formatDateTimeWithRelative(created.apiToken.expiresAt)
							: created.apiToken
								? 'Does not expire'
								: 'N/A'
					}`,
				];

				if (created.apiToken?.tokenSuffix) {
					lines.push(`${chalk.dim('Token Suffix:')} ${created.apiToken.tokenSuffix}`);
				}

				const appendSection = (section: string[]) => {
					if (section.length === 0) {
						return;
					}

					if (lines[lines.length - 1] !== '') {
						lines.push('');
					}

					lines.push(...section);
				};

				const envVarSection: string[] = [];

				if (apiTokenPlainText) {
					envVarSection.push(`${chalk.dim('GHOSTABLE_CI_TOKEN=')}"${apiTokenPlainText}"`);
				}

				if (!options.out) {
					envVarSection.push(`${chalk.dim('GHOSTABLE_DEPLOY_SEED=')}"${privateKeyB64}"`);
				}

				if (envVarSection.length > 0) {
					appendSection(envVarSection);
				}

				if (options.out) {
					const resolved = path.resolve(options.out);
					fs.mkdirSync(path.dirname(resolved), { recursive: true });
					fs.writeFileSync(resolved, `${privateKeyB64}\n`, { mode: 0o600 });
					appendSection([
						`${chalk.dim('Private key written to:')} ${resolved}`,
						'Set GHOSTABLE_DEPLOY_SEED in your CI to the contents of this private key file.',
					]);
				}

				const warningBox = boxen(
					'Store this information securely — it cannot be retrieved again.',
					{
						padding: { top: 0, bottom: 0, left: 1, right: 1 },
						margin: 0,
						borderColor: 'yellow',
						borderStyle: 'round',
					},
				);

				lines.push('');
				lines.push(warningBox);

				log.text(lines.join('\n'));
			} catch (error) {
				spinner.fail('Failed to create deployment token.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}
