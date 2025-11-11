import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';

import { Manifest } from '../../support/Manifest.js';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD } from '@/crypto';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveWorkDir } from '../../support/workdir.js';
import { getIgnoredKeys, filterIgnoredKeys } from '../../support/ignore.js';
import { readEnvFileSafeWithMetadata } from '@/environment/files/env-files.js';
import {
	EnvFileFormat,
	type EnvRenderEntry,
	renderEnvFile,
} from '@/environment/files/env-format.js';
import { registerEnvSubcommand } from './_shared.js';
import { promptWithCancel } from '@/support/prompts.js';

import type { EnvironmentSecret, EnvironmentSecretBundle } from '@/entities';

type PullOptions = {
	env?: string;
	file?: string; // output path; default .env.<env> or .env
	only?: string[]; // repeatable: --only KEY --only OTHER
	dryRun?: boolean; // don't write file; just show summary
	showIgnored?: boolean;
	replace?: boolean;
	pruneLocal?: boolean;
	noBackup?: boolean;
	backup?: boolean;
	format?: string;
};

function resolveOutputPath(envName: string | undefined, explicit?: string): string {
	const workDir = resolveWorkDir();
	if (explicit) return path.resolve(workDir, explicit);
	if (envName) return path.resolve(workDir, `.env.${envName}`);
	return path.resolve(workDir, '.env');
}

const VALID_FORMATS = Object.values(EnvFileFormat);
const FORMAT_PROMPT_CHOICES = [
	{
		name: 'Alphabetical (sort keys A→Z)',
		value: EnvFileFormat.ALPHABETICAL,
	},
	{
		name: 'Grouped (cluster by prefix)',
		value: EnvFileFormat.GROUPED,
	},
	{
		name: 'Grouped with comments (cluster by prefix + heading comments)',
		value: EnvFileFormat.GROUPED_COMMENTS,
	},
];

export function registerEnvPullCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'pull',
			legacy: [{ name: 'env:pull' }],
		},
		(cmd) =>
			cmd
				.description('Pull and decrypt environment secrets into a local .env')
				.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
				.option('--file <PATH>', 'Output file (default: .env.<env> or .env)')
				.option('--only <KEY...>', 'Only include these keys')
				.option('--dry-run', 'Do not write file; just report', false)
				.option('--show-ignored', 'Display ignored keys', false)
				.option('--replace', 'Replace local file instead of merging', false)
				.option('--prune-local', 'Alias for --replace', false)
				.option('--no-backup', 'Do not create a backup before writing')
				.option('--format <FORMAT>', `Output format (${VALID_FORMATS.join('|')})`)
				.action(async (opts: PullOptions) => {
					// 1) Load manifest (project + envs)
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

					// 2) Pick env (flag → prompt)
					let envName = opts.env?.trim();
					if (!envName) {
						envName = await promptWithCancel(() =>
							select<string>({
								message: 'Which environment would you like to pull?',
								choices: envNames.sort().map((n) => ({ name: n, value: n })),
							}),
						);
					}

					const format = opts.format
						? coerceEnvFileFormat(opts.format)
						: await promptWithCancel(() =>
								select<EnvFileFormat>({
									message: 'How should the env file be formatted?',
									choices: FORMAT_PROMPT_CHOICES,
									default: EnvFileFormat.ALPHABETICAL,
								}),
							);

					// 3) Resolve token (org context only affects server-side; decrypt uses AAD)
					let token = process.env.GHOSTABLE_TOKEN || '';
					if (!token) {
						const sessionSvc = new SessionService();
						const sess = await sessionSvc.load();
						if (!sess?.accessToken) {
							log.error(
								'❌ No API token. Run `ghostable login` or set GHOSTABLE_TOKEN.',
							);
							process.exit(1);
						}
						token = sess.accessToken;
					}

					// 4) Fetch secret bundle
					const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);
					let bundle: EnvironmentSecretBundle;
					try {
						bundle = await client.pull(projectId, envName!, {
							includeVersions: true,
							only: opts.only,
							includeMeta: true,
						});
					} catch (error) {
						log.error(`❌ Failed to pull environment bundle: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					if (!bundle.secrets.length) {
						log.warn('No secrets returned; nothing to write.');
						return;
					}

					// 5) Prepare crypto
					await initSodium(); // no-op with stablelib; safe to keep

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
					for (const layer of bundle.chain) {
						envs.add(layer);
					}
					for (const entry of bundle.secrets) {
						envs.add(entry.env);
					}

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

					// 6) Decrypt layer-by-layer and merge (parent → … → child; child wins)
					const chainOrder: readonly string[] = bundle.chain;
					const byEnv = new Map<string, EnvironmentSecret[]>();
					for (const entry of bundle.secrets) {
						if (!byEnv.has(entry.env)) byEnv.set(entry.env, []);
						byEnv.get(entry.env)!.push(entry);
					}

					const merged: Record<string, string> = {};
					const commentFlags: Record<string, boolean> = {};

					for (const layer of chainOrder) {
						const entries: EnvironmentSecret[] = byEnv.get(layer) || [];
						for (const entry of entries) {
							// Derive key from AAD (org/project/env as used at push time)
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
								const value = new TextDecoder().decode(plaintext);

								// Apply merge (child overrides parent)
								merged[entry.name] = value;

								// Track comment flag if meta is included
								commentFlags[entry.name] = Boolean(entry.meta?.is_commented);
							} catch {
								log.warn(`⚠️ Could not decrypt ${entry.name}; skipping`);
							}
						}
					}

					const ignored = getIgnoredKeys(envName);
					const filteredMerged = filterIgnoredKeys(merged, ignored, opts.only);
					const filteredComments = filterIgnoredKeys(commentFlags, ignored, opts.only);
					const ignoredKeysUsed =
						opts.only && opts.only.length ? [] : ignored.filter((key) => key in merged);

					if (opts.showIgnored) {
						const message = ignoredKeysUsed.length
							? `Ignored keys (${ignoredKeysUsed.length}): ${ignoredKeysUsed.join(', ')}`
							: 'Ignored keys (0): none';
						log.info(message);
					}

					// 7) Render dotenv
					const outputPath = resolveOutputPath(envName!, opts.file);
					const { vars: existingVars, snapshots } =
						readEnvFileSafeWithMetadata(outputPath);
					const fileExists = fs.existsSync(outputPath);
					let existingFileContent: string | undefined;
					if (fileExists) {
						try {
							existingFileContent = fs.readFileSync(outputPath, 'utf8');
						} catch {
							// Ignore read errors; we'll treat as needing a rewrite later.
							existingFileContent = undefined;
						}
					}

					const replace = Boolean(opts.replace || opts.pruneLocal);
					const noBackup = opts.backup === false || opts.noBackup === true;
					const serverKeys = Object.keys(filteredMerged);

					let createCount = 0;
					let updateCount = 0;
					for (const key of serverKeys) {
						const snapshot = snapshots[key];
						const current =
							snapshot?.value !== undefined ? snapshot.value : existingVars[key];
						const targetValue = filteredMerged[key];
						const targetCommented = Boolean(filteredComments[key]);
						if (current === undefined) {
							createCount += 1;
							continue;
						}
						const currentCommented = Boolean(snapshot?.commented);
						const valueChanged = current !== targetValue;
						const commentChanged = currentCommented !== targetCommented;
						if (valueChanged || commentChanged) {
							updateCount += 1;
						}
					}

					let deleteCount = 0;
					if (replace) {
						const localKeys = new Set([
							...Object.keys(existingVars),
							...Object.keys(snapshots),
						]);
						for (const key of localKeys) {
							if (!(key in filteredMerged)) {
								deleteCount += 1;
							}
						}
					}

					const hasChanges =
						createCount > 0 || updateCount > 0 || (replace && deleteCount > 0);

					const summaryParts = [`CREATE ${createCount}`, `UPDATE ${updateCount}`];
					if (replace) summaryParts.push(`DELETE ${deleteCount}`);
					const summary = summaryParts.join(' | ');
					log.info(summary);

					const finalEntries = new Map<string, { value: string; commented?: boolean }>();

					if (!replace) {
						const localKeys = new Set([
							...Object.keys(snapshots),
							...Object.keys(existingVars),
						]);
						for (const key of localKeys) {
							const snapshot = snapshots[key];
							const value =
								snapshot?.value !== undefined ? snapshot.value : existingVars[key];
							if (value === undefined) continue;
							finalEntries.set(key, {
								value,
								commented: Boolean(snapshot?.commented),
							});
						}
					}

					for (const key of serverKeys) {
						finalEntries.set(key, {
							value: filteredMerged[key],
							commented: Boolean(filteredComments[key]),
						});
					}

					const entries: EnvRenderEntry[] = Array.from(finalEntries.entries()).map(
						([key, entry]) => ({
							key,
							value: entry.value,
							commented: entry.commented,
							snapshot: snapshots[key],
						}),
					);

					const content = renderEnvFile(entries, { format });
					const formatChanged =
						existingFileContent === undefined
							? !fileExists || Boolean(content.length)
							: existingFileContent !== content;
					const needsWrite = hasChanges || formatChanged;

					if (formatChanged && !hasChanges && fileExists) {
						log.info(
							`Formatting differs from requested output (${format}); will rewrite file.`,
						);
					}

					if (opts.dryRun) {
						const dryRunMsg = needsWrite
							? `Dry run: would update ${outputPath}`
							: `Dry run: no changes for ${outputPath}`;
						log.info(dryRunMsg);
						process.exit(0);
					}

					if (!needsWrite) {
						log.ok(
							`✅ ${outputPath} is already up to date for ${projectName}:${envName}.`,
						);
						return;
					}

					if (!noBackup && fs.existsSync(outputPath)) {
						const timestamp = new Date().toISOString().replace(/:/g, '-');
						const { dir, base } = path.parse(outputPath);
						const backupPath = path.join(dir, `${base}.bak-${timestamp}`);
						fs.copyFileSync(outputPath, backupPath);
						log.info(`Backup created at ${backupPath}`);
					}

					fs.writeFileSync(outputPath, content, 'utf8');

					log.ok(`✅ Updated ${outputPath} for ${projectName}:${envName}.`);
				}),
	);
}

function coerceEnvFileFormat(input?: string): EnvFileFormat {
	if (input && VALID_FORMATS.includes(input as EnvFileFormat)) {
		return input as EnvFileFormat;
	}

	if (!input) {
		return EnvFileFormat.ALPHABETICAL;
	}

	const normalized = input.toLowerCase();
	const match = VALID_FORMATS.find((fmt) => fmt === normalized);
	if (match) {
		return match as EnvFileFormat;
	}

	log.error(`❌ Invalid --format "${input}". Valid options: ${VALID_FORMATS.join(', ')}`);
	process.exit(1);
	return EnvFileFormat.ALPHABETICAL;
}
