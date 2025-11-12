import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import path from 'node:path';

import { Manifest } from '../../support/Manifest.js';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { GhostableClient } from '@/ghostable';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveWorkDir } from '../../support/workdir.js';
import { getIgnoredKeys, filterIgnoredKeys } from '../../support/ignore.js';

import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD } from '@/crypto';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { readEnvFileSafeWithMetadata, resolveEnvFile } from '@/environment/files/env-files.js';
import { registerEnvSubcommand } from './_shared.js';

import type { EnvironmentSecret, EnvironmentSecretBundle } from '@/entities';

type DiffOptions = {
	token?: string;
	env?: string;
	file?: string; // legacy override flag
	local?: string; // preferred override flag
	only?: string[]; // optional; diff just these keys
	showIgnored?: boolean;
};

export function registerEnvDiffCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'diff',
			legacy: [{ name: 'env:diff' }],
		},
		(cmd) =>
			cmd
				.description('Compare your local .env against Ghostable securely')
				.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
				.option('--file <PATH>', 'Local .env path (default: .env.<env> or .env)')
				.option('--local <PATH>', 'Local .env path (alias for --file)')
				.option('--token <TOKEN>', 'API token (or stored session / GHOSTABLE_TOKEN)')
				.option('--only <KEY...>', 'Only diff these keys')
				.option('--show-ignored', 'Display ignored keys', false)
				.action(async (opts: DiffOptions) => {
					// 1) Resolve project + environment from manifest
					let projectId: string, projectName: string, envNames: string[];
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
					}

					let envName = opts.env?.trim();
					if (!envName) {
						envName = await select<string>({
							message: 'Which environment would you like to diff?',
							choices: envNames.sort().map((n) => ({ name: n, value: n })),
						});
					}

					// 2) Resolve token
					let token = opts.token || process.env.GHOSTABLE_TOKEN || '';
					if (!token) {
						const sessionSvc = new SessionService();
						const sess = await sessionSvc.load();
						if (!sess?.accessToken) {
							log.error(
								'❌ No API token. Run `ghostable login` or pass --token / set GHOSTABLE_TOKEN.',
							);
							process.exit(1);
						}
						token = sess.accessToken;
					}

					let deviceService: DeviceIdentityService;
					try {
						deviceService = await DeviceIdentityService.create();
					} catch (error) {
						log.error(`❌ Failed to access device identity: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					let identity;
					try {
						identity = await deviceService.requireIdentity();
					} catch (error) {
						log.error(`❌ Failed to load device identity: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					// 3) Pull encrypted bundle from Ghostable
					const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);
					let bundle: EnvironmentSecretBundle;
					try {
						bundle = await client.pull(projectId, envName!, {
							includeVersions: true,
							only: opts.only,
							includeMeta: true,
							deviceId: identity.deviceId,
						});
					} catch (error) {
						log.error(`❌ Failed to pull environment bundle: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					// 4) Decrypt remote vars locally using environment keys
					await initSodium();

					let envKeyService: EnvironmentKeyService;
					try {
						envKeyService = await EnvironmentKeyService.create();
					} catch (error) {
						log.error(`❌ Failed to access environment keys: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					const envKeys = new Map<string, Uint8Array>();
					const envs = new Set<string>();
					for (const layer of bundle.chain) envs.add(layer);
					for (const entry of bundle.secrets) envs.add(entry.env);

					for (const env of envs) {
						try {
							const { key } = await envKeyService.ensureEnvironmentKey({
								client,
								projectId,
								envName: env,
								identity,
							});
							envKeys.set(env, key);
						} catch (error) {
							log.error(
								`❌ Failed to load environment key for ${env}: ${toErrorMessage(error)}`,
							);
							process.exit(1);
							return;
						}
					}

					const chainOrder: readonly string[] = bundle.chain;
					const byEnv = new Map<string, EnvironmentSecret[]>();
					for (const entry of bundle.secrets) {
						if (!byEnv.has(entry.env)) byEnv.set(entry.env, []);
						byEnv.get(entry.env)!.push(entry);
					}

					const decoder = new TextDecoder();
					const remoteMap: Record<string, { value: string; commented: boolean }> = {};

					for (const layer of chainOrder) {
						const entries: EnvironmentSecret[] = byEnv.get(layer) || [];
						for (const entry of entries) {
							const scope = scopeFromAAD(entry.aad);
							const keyMaterial = envKeys.get(entry.env);
							if (!keyMaterial) {
								log.warn(
									`⚠️ Missing decryption key for ${entry.env}; skipping ${entry.name}`,
								);
								continue;
							}
							const { encKey } = deriveKeys(keyMaterial, scope);

							try {
								const plaintext = aeadDecrypt(encKey, {
									alg: entry.alg,
									nonce: entry.nonce,
									ciphertext: entry.ciphertext,
									aad: entry.aad,
								});
								const value = decoder.decode(plaintext);
								remoteMap[entry.name] = {
									value,
									commented: Boolean(entry.meta?.is_commented),
								};
							} catch {
								log.warn(`⚠️ Could not decrypt ${entry.name}; skipping`);
							}
						}
					}

					// 5) Load local .env for this env (or explicit path)
					const workDir = resolveWorkDir();
					const explicitLocalPath = opts.local?.trim() || opts.file;
					const envPath = resolveEnvFile(
						envName!,
						explicitLocalPath,
						/* mustExist */ false,
					);
					const envScopedPath = envName ? path.resolve(workDir, `.env.${envName}`) : '';
					const defaultEnvPath = path.resolve(workDir, '.env');
					let fallbackUsed = false;
					if (!explicitLocalPath && envName) {
						const resolvedNormalized = path.normalize(envPath);
						if (resolvedNormalized !== path.normalize(envScopedPath)) {
							fallbackUsed = true;
							log.warn(
								`⚠️ ".env.${envName}" not found locally. Falling back to ".env".`,
							);
						}
					}

					let localDisplayName: string;
					if (explicitLocalPath) {
						const relative = path.relative(workDir, envPath);
						localDisplayName = relative.startsWith('..')
							? envPath
							: relative || envPath;
					} else if (envName && !fallbackUsed) {
						localDisplayName = `.env.${envName}`;
					} else {
						localDisplayName =
							path.normalize(envPath) === path.normalize(defaultEnvPath)
								? '.env'
								: path.relative(workDir, envPath);
					}
					const compareMessage = fallbackUsed
						? `Comparing local "${localDisplayName}" to remote environment "${envName}" (fallback used).`
						: `Comparing local "${localDisplayName}" to remote environment "${envName}".`;
					log.info(compareMessage);
					const localMetadata = readEnvFileSafeWithMetadata(envPath);
					const localMap: Record<string, { value: string; commented: boolean }> = {};
					for (const [k, snapshot] of Object.entries(localMetadata.snapshots)) {
						localMap[k] = {
							value: snapshot.value,
							commented: Boolean(snapshot.commented),
						};
					}
					for (const [k, v] of Object.entries(localMetadata.vars)) {
						if (!(k in localMap)) {
							localMap[k] = { value: v, commented: false };
						}
					}

					// 6) Apply ignore list (unless overridden by --only)
					const ignored = getIgnoredKeys(envName);
					const localFiltered = filterIgnoredKeys(localMap, ignored, opts.only);
					const remoteFiltered = filterIgnoredKeys(remoteMap, ignored, opts.only);
					const ignoredKeysUsed =
						opts.only && opts.only.length
							? []
							: ignored.filter((key) => key in localMap || key in remoteMap);

					if (opts.showIgnored) {
						const message = ignoredKeysUsed.length
							? `Ignored keys (${ignoredKeysUsed.length}): ${ignoredKeysUsed.join(', ')}`
							: 'Ignored keys (0): none';
						log.info(message);
					}

					// 7) Optionally restrict to `only`
					const restrict = (keys: string[]) =>
						opts.only && opts.only.length
							? keys.filter((k) => opts.only!.includes(k))
							: keys;

					// 8) Compute diff
					const added: string[] = [];
					const updated: string[] = [];
					const removed: string[] = [];

					// added/updated (present locally)
					for (const key of restrict(Object.keys(localFiltered))) {
						if (!(key in remoteFiltered)) {
							added.push(key);
						} else {
							const lv = localFiltered[key].value;
							const rv = remoteFiltered[key].value;
							const localCommented = localFiltered[key].commented;
							const remoteCommented = remoteFiltered[key].commented;
							if (lv !== rv || localCommented !== remoteCommented) {
								updated.push(key);
							}
						}
					}

					// removed (present remotely, not locally)
					for (const key of restrict(Object.keys(remoteFiltered))) {
						if (!(key in localFiltered)) {
							removed.push(key);
						}
					}

					// 9) Render
					if (!added.length && !updated.length && !removed.length) {
						log.info('No differences detected.');
						return;
					}

					log.info(chalk.bold(`Diff for ${projectName}:${envName}`));
					if (added.length) {
						console.log(chalk.green('\nAdded variables:'));
						for (const k of added) {
							const v = localFiltered[k]?.value ?? '';
							console.log(`  ${chalk.green('+')} ${k}=${v}`);
						}
					}
					if (updated.length) {
						console.log(chalk.yellow('\nUpdated variables:'));
						for (const k of updated) {
							const cur = remoteFiltered[k]?.value ?? '';
							const inc = localFiltered[k]?.value ?? '';
							const commentChanged =
								(remoteFiltered[k]?.commented ?? false) !==
								(localFiltered[k]?.commented ?? false);
							const valueChanged = cur !== inc;
							if (commentChanged && !valueChanged) {
								const nowCommented =
									(localFiltered[k]?.commented ?? false)
										? 'now commented out'
										: 'now active';
								console.log(
									`  ${chalk.yellow('~')} ${k}: ${nowCommented} (value: ${inc})`,
								);
							} else {
								const note = commentChanged ? ' (commented state changed)' : '';
								console.log(`  ${chalk.yellow('~')} ${k}: ${cur} -> ${inc}${note}`);
							}
						}
					}
					if (removed.length) {
						console.log(chalk.red('\nRemoved variables:'));
						for (const k of removed) {
							const v = remoteFiltered[k]?.value ?? '';
							const comment =
								(remoteFiltered[k]?.commented ?? false) ? ' (commented)' : '';
							console.log(`  ${chalk.red('-')} ${k}=${v}${comment}`);
						}
					}

					console.log(''); // trailing newline
					log.ok(
						`Done. Compared local ${path.relative(workDir, envPath)} against Ghostable.`,
					);
				}),
	);
}
