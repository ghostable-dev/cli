import { Command } from 'commander';
import { input, select } from '@inquirer/prompts';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import chalk from 'chalk';

import { initSodium } from '@/crypto';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { HttpError } from '@/ghostable/http/errors.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { detectVersionConflicts, findUntrackedServerKeys } from '@/environment/state/conflicts.js';
import { refreshEnvironmentVersionState } from '@/environment/state/refresh.js';
import { loadEnvironmentVersionState } from '@/environment/state/version-state.js';
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
import { buildEncryptedVariableContextBody } from '@/support/variable-context.js';

export type VarPushOptions = {
	env?: string;
	key?: string;
	file?: string;
	token?: string;
	conflictMode?: string;
	forceOverwrite?: boolean;
};

const VALID_CONFLICT_MODES = ['warn', 'strict'] as const;
type ConflictMode = (typeof VALID_CONFLICT_MODES)[number];

type ApiVersionConflict = {
	key: string;
	serverVersion: number | null;
	clientIfVersion: number | null;
};

type WarnConflictAction = 'pull-and-cancel' | 'continue-overwrite' | 'cancel';

function resolveConflictMode(input?: string): ConflictMode {
	const normalized = (input ?? 'strict').trim().toLowerCase();

	if (normalized === 'warn' || normalized === 'strict') {
		return normalized;
	}

	log.error(
		`❌ Invalid --conflict-mode "${input}". Valid options: ${VALID_CONFLICT_MODES.join(', ')}`,
	);
	process.exit(1);
	return 'strict';
}

function formatVersion(value: number | null): string {
	return value === null ? 'none' : `v${value}`;
}

function parsePushConflicts(error: HttpError): ApiVersionConflict[] {
	const raw = error.body?.trim();
	if (!raw) {
		return [];
	}

	try {
		const parsed = JSON.parse(raw) as {
			conflicts?: Array<{
				key?: unknown;
				server_version?: unknown;
				client_if_version?: unknown;
			}>;
		};

		if (!Array.isArray(parsed.conflicts)) {
			return [];
		}

		return parsed.conflicts
			.map((entry) => {
				const key = typeof entry.key === 'string' ? entry.key : '';
				const serverVersion =
					typeof entry.server_version === 'number' &&
					Number.isFinite(entry.server_version)
						? Math.trunc(entry.server_version)
						: null;
				const clientIfVersion =
					typeof entry.client_if_version === 'number' &&
					Number.isFinite(entry.client_if_version)
						? Math.trunc(entry.client_if_version)
						: null;

				return key ? { key, serverVersion, clientIfVersion } : null;
			})
			.filter((entry): entry is ApiVersionConflict => entry !== null);
	} catch {
		return [];
	}
}

async function promptWarnConflictAction(opts: {
	envName: string;
	keyName: string;
	staleCount: number;
	untrackedCount: number;
}): Promise<WarnConflictAction> {
	const reasons: string[] = [];
	if (opts.staleCount > 0) {
		reasons.push(`${opts.staleCount} stale key`);
	}
	if (opts.untrackedCount > 0) {
		reasons.push(`${opts.untrackedCount} untracked server key`);
	}

	const reasonText = reasons.length ? ` (${reasons.join(', ')})` : '';

	return promptWithCancel(() =>
		select<WarnConflictAction>({
			message: `Remote changes detected for ${opts.envName}/${opts.keyName}${reasonText}. What should this push do?`,
			default: 'pull-and-cancel',
			choices: [
				{
					name: 'Pull latest and cancel push (Recommended)',
					value: 'pull-and-cancel',
					description:
						'Stops now so you can sync with `ghostable env pull`, review updates, and push intentionally.',
				},
				{
					name: 'Continue and overwrite server value',
					value: 'continue-overwrite',
					description:
						'Uploads the local value now and replaces the newer server-side value for this key.',
				},
				{
					name: 'Cancel without changes',
					value: 'cancel',
					description: 'Exits immediately without uploading anything.',
				},
			],
		}),
	);
}

function runInlineEnvPull(opts: { envName: string; file?: string; token?: string }): boolean {
	const cliEntry = process.argv[1];
	if (!cliEntry) {
		return false;
	}

	const args = [cliEntry, 'env', 'pull', '--env', opts.envName];
	if (opts.file) {
		args.push('--file', opts.file);
	}

	const childEnv = { ...process.env };
	if (opts.token && opts.token.trim().length > 0) {
		childEnv.GHOSTABLE_TOKEN = opts.token;
	}

	const result = spawnSync(process.execPath, args, {
		stdio: 'inherit',
		env: childEnv,
	});

	return result.status === 0;
}

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
				.option(
					'--conflict-mode <MODE>',
					'Conflict handling mode: strict (default) or warn',
					'strict',
				)
				.option(
					'--force-overwrite',
					'Bypass optimistic version checks and overwrite remote values',
					false,
				)
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
					const conflictMode = resolveConflictMode(opts.conflictMode);
					const forceOverwrite = Boolean(opts.forceOverwrite);

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

					const localState = loadEnvironmentVersionState(projectId, envName!);
					let serverVersions: Record<string, number> = {};
					let serverVersionsLoaded = false;
					try {
						const keysResponse = await client.getEnvironmentKeys(projectId, envName!);
						serverVersions = {};
						let versionCount = 0;
						for (const entry of keysResponse.data) {
							if (
								typeof entry.version !== 'number' ||
								!Number.isFinite(entry.version)
							) {
								continue;
							}
							serverVersions[entry.name] = Math.trunc(entry.version);
							versionCount += 1;
						}
						if (keysResponse.data.length > 0 && versionCount === 0) {
							if (conflictMode === 'strict' && !forceOverwrite) {
								log.error(
									'❌ Strict conflict mode requires server key versions, but the server response did not include any.',
								);
								log.error(
									'Upgrade the Ghostable API/CLI to a build that supports `include_versions`, or use --force-overwrite.',
								);
								process.exit(1);
								return;
							}

							log.warn(
								'⚠️ Server key versions were not returned; optimistic conflict checks are unavailable for this push.',
							);
							serverVersionsLoaded = false;
						} else {
							serverVersionsLoaded = true;
						}
					} catch (error) {
						if (conflictMode === 'strict' && !forceOverwrite) {
							log.error(
								`❌ Strict conflict mode requires current server versions, but they could not be loaded: ${toErrorMessage(error)}`,
							);
							process.exit(1);
							return;
						}

						log.warn(
							`⚠️ Could not load server-side key versions for conflict checks: ${toErrorMessage(error)}`,
						);
					}

					const localVersions = localState?.versions ?? {};
					const staleConflicts =
						serverVersionsLoaded && localState
							? detectVersionConflicts([target.name], localVersions, serverVersions)
							: [];
					const untrackedRemoteKeys =
						serverVersionsLoaded && localState
							? findUntrackedServerKeys([target.name], localVersions, serverVersions)
							: [];

					if (conflictMode === 'strict' && !forceOverwrite) {
						if (!localState) {
							log.error(
								'❌ Strict conflict mode requires a local version baseline. Run `ghostable env state refresh` (or pull first) and retry.',
							);
							process.exit(1);
							return;
						}

						if (staleConflicts.length || untrackedRemoteKeys.length) {
							log.error(
								'❌ Strict conflict mode blocked this push due to version drift for the selected key.',
							);
							for (const conflict of staleConflicts) {
								log.error(
									`  - ${conflict.key}: local ${formatVersion(conflict.clientIfVersion)} vs server ${formatVersion(conflict.serverVersion)}`,
								);
							}
							for (const key of untrackedRemoteKeys) {
								log.error(
									`  - ${key}: server key exists but local state has no baseline version`,
								);
							}
							log.error(
								'Run `ghostable env state refresh` to update versions, or use --force-overwrite.',
							);
							process.exit(1);
							return;
						}
					} else if (!forceOverwrite) {
						for (const conflict of staleConflicts) {
							log.warn(
								`⚠️ ${conflict.key} is stale locally (${formatVersion(conflict.clientIfVersion)} vs ${formatVersion(conflict.serverVersion)}). It will be overwritten in warn mode.`,
							);
						}
						for (const key of untrackedRemoteKeys) {
							log.warn(
								`⚠️ ${key} exists on the server without a local baseline version; optimistic conflict checks are skipped in warn mode.`,
							);
						}

						const shouldPromptForConflictAction =
							conflictMode === 'warn' &&
							process.stdin.isTTY === true &&
							process.stdout.isTTY === true &&
							(staleConflicts.length > 0 || untrackedRemoteKeys.length > 0);

						if (shouldPromptForConflictAction) {
							const action = await promptWarnConflictAction({
								envName: envName!,
								keyName: target.name,
								staleCount: staleConflicts.length,
								untrackedCount: untrackedRemoteKeys.length,
							});

							if (action === 'pull-and-cancel') {
								log.info('Running `ghostable env pull` to sync local values…');
								const pulled = runInlineEnvPull({
									envName: envName!,
									file: opts.file,
									token: sessionToken,
								});
								if (pulled) {
									log.ok(
										`Pulled latest values for ${envName!}. Push canceled; review changes and push again if needed.`,
									);
								} else {
									log.warn(
										`Push canceled. Pull did not complete; run \`ghostable env pull --env ${envName!}\` manually.`,
									);
								}
								return;
							}

							if (action === 'cancel') {
								log.warn('Push canceled.');
								return;
							}

							log.warn(
								'⚠️ Continuing in warn mode. The local value may overwrite a newer server-side value.',
							);
						}
					}

					let changeReason: string | undefined;
					if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
						const enteredReason = await promptWithCancel(() =>
							input({
								message: 'Reason for change (optional)',
								default: '',
							}),
						);

						changeReason = enteredReason.trim() || undefined;
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
						const localVersion = localVersions[target.name];
						const shouldIncludeIfVersion =
							!forceOverwrite &&
							localState !== null &&
							serverVersionsLoaded &&
							localVersion !== undefined &&
							(conflictMode === 'strict' || staleConflicts.length === 0);

						const changeNote = changeReason
							? await buildEncryptedVariableContextBody({
									orgId: orgId,
									projectId,
									environmentName: envName!,
									variableName: target.name,
									scope: 'change_note',
									plaintext: changeReason,
									keyMaterial: keyInfo.key,
									signingPrivateKey: edPriv,
								})
							: undefined;

						const payload = await buildSecretPayload({
							name: target.name,
							env: envName!,
							org: orgId,
							project: projectId,
							plaintext: target.plaintext,
							keyMaterial: keyInfo.key,
							edPriv,
							ifVersion: shouldIncludeIfVersion ? localVersion : undefined,
							changeNote,
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
							force_overwrite: forceOverwrite,
						};
						await client.push(projectId, envName!, requestBody);

						try {
							await refreshEnvironmentVersionState({
								client,
								projectId,
								envName: envName!,
								source: 'push',
							});
						} catch (error) {
							log.warn(
								`⚠️ Push succeeded, but failed to refresh local version state: ${toErrorMessage(error)}`,
							);
						}

						log.ok(
							`✅ Pushed ${chalk.bold(target.name)} from ${chalk.bold(
								filePath,
							)} to ${projectId}:${envName!}.`,
						);
					} catch (error) {
						if (error instanceof HttpError && error.status === 409) {
							const conflicts = parsePushConflicts(error);
							if (conflicts.length) {
								log.error('❌ Push rejected due to version conflicts:');
								for (const conflict of conflicts) {
									log.error(
										`  - ${conflict.key}: local ${formatVersion(conflict.clientIfVersion)} vs server ${formatVersion(conflict.serverVersion)}`,
									);
								}
								log.error(
									'Run `ghostable env state refresh` and retry, or pass --force-overwrite.',
								);
							}
						}

						log.error(`❌ Failed to push variable: ${toErrorMessage(error)}`);
						process.exit(1);
					}
				}),
	);
}
