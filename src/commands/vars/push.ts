import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import fs from 'node:fs';
import chalk from 'chalk';

import { initSodium } from '@/crypto';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import {
	resolveEnvFile,
	readEnvFileSafeWithMetadata,
	type EnvVarSnapshot,
} from '@/environment/files/env-files.js';
import { getIgnoredKeys, filterIgnoredKeys } from '../../support/ignore.js';
import { buildSecretPayload } from '../../support/secret-payload.js';
import { registerVarSubcommand } from './_shared.js';
import { promptWithCancel } from '@/support/prompts.js';

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
	registerVarSubcommand(
		program,
		{
			subcommand: 'push',
			legacy: [{ name: 'var:push' }],
		},
		(cmd) =>
			cmd
				.description('Encrypt and push one environment variable to Ghostable')
				.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
				.option(
					'--key <KEY>',
					'Environment variable name (if omitted, select from local list)',
				)
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
						envName = await promptWithCancel(() =>
							select<string>({
								message: 'Which environment would you like to push?',
								choices: envNames.sort().map((name) => ({ name, value: name })),
							}),
						);
					}

					const filePath = resolveEnvFile(envName!, opts.file, true);
					if (!fs.existsSync(filePath)) {
						log.error(`❌ .env file not found at ${filePath}`);
						process.exit(1);
						return;
					}

					const { vars: envMap, snapshots } = readEnvFileSafeWithMetadata(filePath);
					const mergedVars: Record<string, string> = { ...envMap };
					for (const [name, snapshot] of Object.entries(snapshots)) {
						if (!(name in mergedVars) && snapshot.commented) {
							mergedVars[name] = snapshot.value;
						}
					}
					const ignored = getIgnoredKeys(envName);
					const filtered = filterIgnoredKeys(mergedVars, ignored);
					const entries = Object.entries(filtered)
						.map(([name, parsedValue]) => {
							const snapshot = snapshots[name];
							const rawSource = snapshot?.rawValue ?? parsedValue ?? '';
							return {
								name,
								parsedValue,
								plaintext: resolvePlaintext(parsedValue, snapshot),
								commented: Boolean(snapshot?.commented),
								lineBytes: Buffer.byteLength(rawSource, 'utf8'),
							};
						})
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
						keyName = await promptWithCancel(() =>
							select<string>({
								message: `Select a variable to push from ${projectName}/${envName}:`,
								choices: entries.map((entry) => ({
									name: entry.commented
										? `${entry.name} (commented)`
										: entry.name,
									value: entry.name,
								})),
							}),
						);
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
					const client = GhostableClient.unauthenticated(config.apiBase).withToken(
						sessionToken,
					);

					if (!orgId) {
						try {
							const project = await client.getProject(projectId);
							orgId = project.organizationId;
						} catch (error) {
							log.error(
								`❌ Failed to resolve organization for project ${projectId}: ${toErrorMessage(error)}`,
							);
							process.exit(1);
							return;
						}
					}

					if (!orgId) {
						log.error(
							'❌ Organization context is required to push environment variables.',
						);
						process.exit(1);
						return;
					}

					let envId: string;
					try {
						const environments = await client.getEnvironments(projectId);
						const normalized = envName!.toLowerCase();
						const match = environments.find(
							(env) => env.name.toLowerCase() === normalized,
						);
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

					const edPriv = Buffer.from(identity.signingKey.privateKey, 'base64');

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

					try {
						const payload = await buildSecretPayload({
							name: target.name,
							env: envName!,
							org: orgId,
							project: projectId,
							plaintext: target.plaintext,
							keyMaterial: keyInfo.key,
							edPriv,
							envKekVersion: keyInfo.version,
							envKekFingerprint: keyInfo.fingerprint,
							meta: {
								lineBytes: target.lineBytes,
								isCommented: target.commented,
							},
						});

						const requestBody = {
							device_id: identity.deviceId,
							secrets: [payload],
						};
						await client.push(projectId, envName!, requestBody);
						log.ok(
							`✅ Pushed ${chalk.bold(target.name)} from ${chalk.bold(
								filePath,
							)} to ${projectId}:${envName!}.`,
						);
					} catch (error) {
						log.error(`❌ Failed to push variable: ${toErrorMessage(error)}`);
						process.exit(1);
					}
				}),
	);
}
