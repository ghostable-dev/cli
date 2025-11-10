import fs from 'node:fs';
import path from 'node:path';
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
import { buildDeploymentTokenSummaryLines } from './output.js';

import { KeyService, MemoryKeyStore } from '@/crypto';
import { formatDeploymentTokenLabel } from '@/entities';

export function configureRotateCommand(parent: Command) {
	parent
		.command('rotate')
		.description('Rotate the keypair for an existing deployment token')
		.option('--env <ENV>', 'Environment name or ID that owns the token')
		.option('--token <ID>', 'Deployment token ID to rotate')
		.option('--out <FILE>', 'Write the new private key to a file instead of stdout')
		.action(async (options: { env?: string; token?: string; out?: string }) => {
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
				log.error(`❌ No deployment tokens available for ${environment.name}.`);
				process.exit(1);
			}

			let target = options.token
				? tokens.find((token) => token.id === options.token)
				: undefined;

			if (!target) {
				const choice = await select<string>({
					message: 'Select a deployment token to rotate',
					choices: tokens.map((token) => ({
						name: formatDeploymentTokenLabel(token),
						value: token.id,
					})),
				});
				target = tokens.find((token) => token.id === choice);
			}

			if (!target) {
				log.error('❌ Deployment token not found.');
				process.exit(1);
			}

			KeyService.initialize(new MemoryKeyStore());
			const spinner = ora('Minting replacement keypair…').start();
			try {
				const identity = await KeyService.createDeviceIdentity(
					target.name,
					'deployment-token',
				);
				const privateKeyB64 = identity.encryptionKey.privateKey;

				spinner.text = 'Updating token on Ghostable…';
				const rotatedToken = await client.rotateDeployToken(projectId, target.id, {
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
					extraDeployTokens: [rotatedToken.token],
				});

				spinner.succeed('Deployment token rotated.');
				log.line();
				let privateKeyPath: string | undefined;
				if (options.out) {
					const resolved = path.resolve(options.out);
					fs.mkdirSync(path.dirname(resolved), { recursive: true });
					fs.writeFileSync(resolved, `${privateKeyB64}\n`, {
						mode: 0o600,
					});
					privateKeyPath = resolved;
				}

				const lines = buildDeploymentTokenSummaryLines({
					result: rotatedToken,
					environmentName: environment.name,
					privateKeyB64,
					includeInlinePrivateKey: !options.out,
					privateKeyPath,
				});
				log.text(lines.join('\n'));
			} catch (error) {
				spinner.fail('Failed to rotate deployment token.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}
