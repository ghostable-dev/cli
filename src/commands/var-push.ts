import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import fs from 'node:fs';
import chalk from 'chalk';

import { initSodium } from '@/crypto';
import { loadOrCreateKeys } from '@/keychain';
import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '../services/GhostableClient.js';
import { DeviceIdentityService } from '../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '../services/EnvironmentKeyService.js';
import { Manifest } from '../support/Manifest.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import {
	resolveEnvFile,
	readEnvFileSafeWithMetadata,
	type EnvVarSnapshot,
} from '../support/env-files.js';
import { getIgnoredKeys, filterIgnoredKeys } from '../support/ignore.js';
import { buildSecretPayload } from '../support/secret-payload.js';

import type { ValidatorRecord } from '@/crypto';

export type VarPushOptions = {
	env?: string;
	key?: string;
	file?: string;
	token?: string;
};

function resolvePlaintext(parsed: string, snapshot?: EnvVarSnapshot): string {
	if (!snapshot) return parsed;

	const trimmed = snapshot.rawValue.trim();
	if (trimmed.length < 2) return parsed;

	const first = trimmed[0];
	if (first !== '"' && first !== "'") return parsed;
	if (trimmed[trimmed.length - 1] !== first) return parsed;

	return trimmed;
}

export function registerVarPushCommand(program: Command) {
	program
		.command('var:push')
		.description('Encrypt and push a single environment variable to Ghostable')
		.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
		.option('--key <KEY>', 'Environment variable name (if omitted, select from local list)')
		.option('--file <PATH>', 'Path to .env file (default: .env.<env> or .env)')
		.option('--token <TOKEN>', 'API token (or stored session / GHOSTABLE_TOKEN)')
		.action(async (opts: VarPushOptions) => {
			let projectId: string;
			let projectName: string;
			let envNames: string[];

			try {
				projectId = Manifest.id();
				projectName = Manifest.name();
				envNames = Manifest.environmentNames();
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			if (!envNames.length) {
				log.error('❌ No environments defined in .ghostable/ghostable.yaml.');
				process.exit(1);
				return;
			}

			let envName = opts.env?.trim();
			if (!envName) {
				envName = await select<string>({
					message: 'Which environment would you like to push?',
					choices: envNames.sort().map((name) => ({ name, value: name })),
				});
			}

			const filePath = resolveEnvFile(envName!, opts.file, true);
			if (!fs.existsSync(filePath)) {
				log.error(`❌ .env file not found at ${filePath}`);
				process.exit(1);
				return;
			}

			const { vars: envMap, snapshots } = readEnvFileSafeWithMetadata(filePath);
			const ignored = getIgnoredKeys(envName);
			const filtered = filterIgnoredKeys(envMap, ignored);
			const entries = Object.entries(filtered)
				.map(([name, parsedValue]) => ({
					name,
					parsedValue,
					plaintext: resolvePlaintext(parsedValue, snapshots[name]),
				}))
				.sort((a, b) => a.name.localeCompare(b.name));

			if (!entries.length) {
				log.warn('⚠️  No variables found in the .env file.');
				return;
			}

			let keyName = opts.key?.trim();
			if (keyName) {
				const exists = entries.find((entry) => entry.name === keyName);
				if (!exists) {
					log.error(`❌ Variable "${keyName}" was not found in ${filePath}.`);
					process.exit(1);
					return;
				}
			} else {
				keyName = await select<string>({
					message: `Select a variable to push from ${projectName}/${envName}:`,
					choices: entries.map((entry) => ({
						name: entry.name,
						value: entry.name,
					})),
				});
			}

			let token = opts.token || process.env.GHOSTABLE_TOKEN || '';
			let orgId = '';
			if (!token) {
				const sessionSvc = new SessionService();
				const sess = await sessionSvc.load();
				if (!sess?.accessToken) {
					log.error(
						'❌ No API token. Run `ghostable login` or pass --token / set GHOSTABLE_TOKEN.',
					);
					process.exit(1);
					return;
				}
				token = sess.accessToken;
				orgId = sess.organizationId ?? '';
			} else {
				const sessionSvc = new SessionService();
				const sess = await sessionSvc.load();
				if (sess?.organizationId) {
					orgId = sess.organizationId;
				}
			}

			const target = entries.find((entry) => entry.name === keyName)!;

			const sessionToken = token;
			const client = GhostableClient.unauthenticated(config.apiBase).withToken(sessionToken);

			let envId: string;
			try {
				const environments = await client.getEnvironments(projectId);
				const normalized = envName!.toLowerCase();
				const match = environments.find((env) => env.name.toLowerCase() === normalized);
				if (!match) {
					log.error(
						`❌ Environment '${envName}' was not found for project ${projectName}.`,
					);
					process.exit(1);
					return;
				}
				envId = match.id;
			} catch (error) {
				log.error(`❌ Failed to load environments: ${toErrorMessage(error)}`);
				process.exit(1);
				return;
			}

			await initSodium();
			const keyBundle = await loadOrCreateKeys();
			const edPriv = Buffer.from(keyBundle.ed25519PrivB64.replace(/^b64:/, ''), 'base64');

			let identityService: DeviceIdentityService;
			try {
				identityService = await DeviceIdentityService.create();
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			let identity;
			try {
				identity = await identityService.requireIdentity();
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			let envKeyService: EnvironmentKeyService;
			try {
				envKeyService = await EnvironmentKeyService.create();
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			let keyInfo: Awaited<ReturnType<EnvironmentKeyService['ensureEnvironmentKey']>>;
			try {
				keyInfo = await envKeyService.ensureEnvironmentKey({
					client,
					projectId,
					envName: envName!,
					identity,
				});

				if (keyInfo.created) {
					await envKeyService.publishKeyEnvelopes({
						client,
						projectId,
						envId,
						envName: envName!,
						identity,
						key: keyInfo.key,
						version: keyInfo.version,
						fingerprint: keyInfo.fingerprint,
						created: true,
					});
				}
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			const validators: ValidatorRecord = {
				non_empty: target.parsedValue.length > 0,
			};

			if (target.name === 'APP_KEY') {
				validators.regex = {
					id: 'base64_44char_v1',
					ok: /^base64:/.test(target.parsedValue) && target.parsedValue.length >= 44,
				};
				validators.length = target.parsedValue.length;
			}

			try {
				const payload = await buildSecretPayload({
					name: target.name,
					env: envName!,
					org: orgId,
					project: projectId,
					plaintext: target.plaintext,
					keyMaterial: keyInfo.key,
					edPriv,
					validators,
					envKekVersion: keyInfo.version,
					envKekFingerprint: keyInfo.fingerprint,
				});

				await client.uploadSecret(projectId, envName!, payload);
				log.ok(
					`✅ Pushed ${chalk.bold(target.name)} from ${chalk.bold(
						filePath,
					)} to ${projectId}:${envName!}.`,
				);
			} catch (error) {
				log.error(`❌ Failed to push variable: ${toErrorMessage(error)}`);
				process.exit(1);
			}
		});
}
