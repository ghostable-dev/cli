import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { input } from '@inquirer/prompts';
import ora from 'ora';

import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
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
					envName: environment.name,
					identity: deviceIdentity,
				});

				spinner.succeed('Deployment token created.');
				log.ok(`✅ Token ID: ${created.token.id}`);
				log.ok(`🌱 Environment: ${environment.name}`);
				if (created.secret) {
					log.ok(`🔐 Access token: ${created.secret}`);
				}

				if (options.out) {
					const resolved = path.resolve(options.out);
					fs.mkdirSync(path.dirname(resolved), { recursive: true });
					fs.writeFileSync(resolved, `${privateKeyB64}\n`, { mode: 0o600 });
					log.ok(`🔑 Private key written to ${resolved}`);
				} else {
					log.info('🔑 Save this private key securely (Base64):');
					console.log(privateKeyB64);
				}
			} catch (error) {
				spinner.fail('Failed to create deployment token.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}
