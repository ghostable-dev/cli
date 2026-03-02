import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';

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
import { getIgnoredKeys, filterIgnoredKeys } from '../../support/ignore.js';
import { resolveEnvFile, readEnvFileSafeWithMetadata } from '@/environment/files/env-files.js';
import { initSodium } from '@/crypto';
import { buildSecretPayload } from '../../support/secret-payload.js';
import { promptWithCancel } from '@/support/prompts.js';
import { registerEnvSubcommand } from './_shared.js';
import type { SignedEnvironmentSecretUploadRequest } from '@/ghostable/types/environment.js';

export type PushOptions = {
	api?: string;
	token?: string;
	file?: string; // optional override; else .env.<env> or .env
	env?: string; // optional; prompt if missing
	assumeYes?: boolean;
	sync?: boolean;
	replace?: boolean;
	pruneServer?: boolean;
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
	const normalized = (input ?? 'warn').trim().toLowerCase();

	if (normalized === 'warn' || normalized === 'strict') {
		return normalized;
	}

	log.error(
		`❌ Invalid --conflict-mode "${input}". Valid options: ${VALID_CONFLICT_MODES.join(', ')}`,
	);
	process.exit(1);
	return 'warn';
}

function formatVersion(value: number | null): string {
	return value === null ? 'none' : `v${value}`;
}

function parseDateMs(value: string): number | null {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
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
	staleCount: number;
	untrackedCount: number;
	baselineMayOutrunLocalFile: boolean;
}): Promise<WarnConflictAction> {
	const reasons: string[] = [];
	if (opts.staleCount > 0) {
		reasons.push(`${opts.staleCount} stale key(s)`);
	}
	if (opts.untrackedCount > 0) {
		reasons.push(`${opts.untrackedCount} untracked server key(s)`);
	}
	if (opts.baselineMayOutrunLocalFile) {
		reasons.push('state newer than local .env file');
	}

	const reasonText = reasons.length ? ` (${reasons.join(', ')})` : '';

	return promptWithCancel(() =>
		select<WarnConflictAction>({
			message: `Remote changes detected for ${opts.envName}${reasonText}. What should this push do?`,
			default: 'pull-and-cancel',
			choices: [
				{
					name: 'Pull latest and cancel push (Recommended)',
					value: 'pull-and-cancel',
					description:
						'Stops now so you can sync with `ghostable env pull`, review updates, and push intentionally.',
				},
				{
					name: 'Continue and overwrite server values',
					value: 'continue-overwrite',
					description:
						'Uploads local values now and replaces newer server-side values for affected keys.',
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

export function registerEnvPushCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'push',
			legacy: [{ name: 'env:push' }],
		},
		(cmd) =>
			cmd
				.description('Encrypt and push your local .env file to Ghostable')
				.option('--file <PATH>', 'Path to .env file (default: .env.<env> or .env)')
				.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
				.option('-y, --assume-yes', 'Skip confirmation prompts', false)
				.option('--sync', 'Prune server variables not present locally', false)
				.option('--replace', 'Alias for --sync', false)
				.option('--prune-server', 'Alias for --sync', false)
				.option(
					'--conflict-mode <MODE>',
					'Conflict handling mode: warn (default) or strict',
					'warn',
				)
				.option(
					'--force-overwrite',
					'Bypass optimistic version checks and overwrite remote values',
					false,
				)
				.action(async (opts: PushOptions) => runEnvPush(opts)),
	);
}

export async function runEnvPush(opts: PushOptions): Promise<void> {
	// 1) Load manifest
	let projectId: string, projectName: string, manifestEnvs: string[];
	try {
		projectId = Manifest.id();
		projectName = Manifest.name();
		manifestEnvs = Manifest.environmentNames();
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
		return;
	}
	if (!manifestEnvs.length) {
		log.error('❌ No environments defined in .ghostable/ghostable.yaml.');
		process.exit(1);
	}

	// 2) Pick env (flag → prompt)
	let envName = opts.env;
	if (!envName) {
		envName = await select({
			message: 'Which environment would you like to push?',
			choices: manifestEnvs.sort().map((n) => ({ name: n, value: n })),
		});
	}

	// 3) Resolve token / org
	const sessionSvc = new SessionService();
	const tokenFromEnv = process.env.GHOSTABLE_TOKEN?.trim() || '';
	const sess = tokenFromEnv ? null : await sessionSvc.load();
	const token = tokenFromEnv || sess?.accessToken || '';
	if (!token) {
		log.error('❌ No API token. Run `ghostable login` or set GHOSTABLE_TOKEN.');
		process.exit(1);
	}
	let orgId = sess?.organizationId ?? '';

	// 4) Resolve .env file path
	const filePath = resolveEnvFile(envName!, opts.file, true);
	if (!fs.existsSync(filePath)) {
		log.error(`❌ .env file not found at ${filePath}`);
		process.exit(1);
	}

	// 5) Read variables + apply ignore list
	const { vars: envMap, snapshots } = readEnvFileSafeWithMetadata(filePath);
	const mergedVars: Record<string, string> = { ...envMap };
	for (const [name, snapshot] of Object.entries(snapshots)) {
		if (!(name in mergedVars) && snapshot.commented) {
			mergedVars[name] = snapshot.value;
		}
	}

	const ignored = getIgnoredKeys(envName);
	const filteredVars = filterIgnoredKeys(mergedVars, ignored);
	const sortedKeys = Object.keys(filteredVars).sort((a, b) => a.localeCompare(b));
	const entryCount = sortedKeys.length;
	if (!entryCount) {
		log.warn('⚠️  No variables found in the .env file.');
		return;
	}

	const conflictMode = resolveConflictMode(opts.conflictMode);
	const forceOverwrite = Boolean(opts.forceOverwrite);

	if (!opts.assumeYes) {
		log.info(
			`About to push ${entryCount} variables from ${chalk.bold(filePath)}\n` +
				`→ project ${chalk.bold(projectName)} (${projectId})\n` +
				(orgId ? `→ org ${chalk.bold(orgId)}\n` : ''),
		);
	}

	const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);

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
		log.error('❌ Organization context is required to push environment variables.');
		process.exit(1);
		return;
	}

	let envId: string;
	try {
		const environments = await client.getEnvironments(projectId);
		const normalized = envName!.toLowerCase();
		const match = environments.find((env) => env.name.toLowerCase() === normalized);
		if (!match) {
			log.error(`❌ Environment '${envName}' was not found for project ${projectName}.`);
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
	const stateUpdatedAtMs = localState ? parseDateMs(localState.updatedAt) : null;
	const fileModifiedAtMs = (() => {
		try {
			return fs.statSync(filePath).mtimeMs;
		} catch {
			return null;
		}
	})();
	const baselineMayOutrunLocalFile =
		localState?.source === 'state-refresh' &&
		stateUpdatedAtMs !== null &&
		fileModifiedAtMs !== null &&
		fileModifiedAtMs < stateUpdatedAtMs;

	let serverVersions: Record<string, number> = {};
	let serverVersionsLoaded = false;
	try {
		const keysResponse = await client.getEnvironmentKeys(projectId, envName!);
		serverVersions = {};
		let versionCount = 0;
		for (const entry of keysResponse.data) {
			if (typeof entry.version !== 'number' || !Number.isFinite(entry.version)) {
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
			? detectVersionConflicts(sortedKeys, localVersions, serverVersions)
			: [];
	const staleKeys = new Set(staleConflicts.map((conflict) => conflict.key));
	const untrackedRemoteKeys =
		serverVersionsLoaded && localState
			? findUntrackedServerKeys(sortedKeys, localVersions, serverVersions).filter(
					(key) => !staleKeys.has(key),
				)
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
			log.error('❌ Strict conflict mode blocked this push due to version drift.');
			for (const conflict of staleConflicts.slice(0, 10)) {
				log.error(
					`  - ${conflict.key}: local ${formatVersion(conflict.clientIfVersion)} vs server ${formatVersion(conflict.serverVersion)}`,
				);
			}
			for (const key of untrackedRemoteKeys.slice(0, 10)) {
				log.error(`  - ${key}: server key exists but local state has no baseline version`);
			}
			if (staleConflicts.length > 10 || untrackedRemoteKeys.length > 10) {
				log.error('  - …');
			}
			log.error(
				'Run `ghostable env state refresh` to update versions, or use --force-overwrite.',
			);
			process.exit(1);
			return;
		}
	} else if (!forceOverwrite) {
		if (!localState) {
			log.warn(
				'⚠️ No local version baseline found; push will proceed without optimistic conflict checks. Run `ghostable env state refresh` to enable them.',
			);
		} else {
			if (baselineMayOutrunLocalFile) {
				log.warn(
					'⚠️ Local version state was refreshed more recently than this .env file. Run `ghostable env pull --env <env>` to avoid overwriting newer server values.',
				);
			}
			if (staleConflicts.length) {
				log.warn(
					`⚠️ ${staleConflicts.length} key(s) appear stale locally. They will be overwritten in warn mode.`,
				);
				for (const conflict of staleConflicts.slice(0, 10)) {
					log.warn(
						`  - ${conflict.key}: local ${formatVersion(conflict.clientIfVersion)} vs server ${formatVersion(conflict.serverVersion)}`,
					);
				}
				if (staleConflicts.length > 10) {
					log.warn('  - …');
				}
			}
			if (untrackedRemoteKeys.length) {
				log.warn(
					`⚠️ ${untrackedRemoteKeys.length} key(s) exist on the server without local baseline versions; optimistic checks will be skipped for those keys.`,
				);
			}

			const shouldPromptForConflictAction =
				conflictMode === 'warn' &&
				!opts.assumeYes &&
				process.stdin.isTTY === true &&
				process.stdout.isTTY === true &&
				(staleConflicts.length > 0 ||
					untrackedRemoteKeys.length > 0 ||
					baselineMayOutrunLocalFile);

			if (shouldPromptForConflictAction) {
				const action = await promptWarnConflictAction({
					envName: envName!,
					staleCount: staleConflicts.length,
					untrackedCount: untrackedRemoteKeys.length,
					baselineMayOutrunLocalFile,
				});

				if (action === 'pull-and-cancel') {
					log.info('Running `ghostable env pull` to sync local values…');
					const pulled = runInlineEnvPull({
						envName: envName!,
						file: opts.file,
						token,
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
					'⚠️ Continuing in warn mode. Local values may overwrite newer server-side values.',
				);
			}
		}
	}

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

	const spinner = ora('Encrypting environment…').start();
	try {
		spinner.text = 'Ensuring environment key…';
		const envKeyService = await EnvironmentKeyService.create();
		const keyInfo = await envKeyService.ensureEnvironmentKey({
			client,
			projectId,
			envName: envName!,
			identity,
		});

		if (keyInfo.created) {
			spinner.text = 'Sharing environment key with team devices…';
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

		spinner.text = 'Encrypting environment variables locally…';
		await initSodium();
		const edPriv = Buffer.from(identity.signingKey.privateKey, 'base64');

		const secrets = [] as SignedEnvironmentSecretUploadRequest[];
		for (const name of sortedKeys) {
			const value = filteredVars[name] ?? '';
			const snapshot = snapshots[name];
			const lineBytes = Buffer.byteLength(snapshot?.rawValue ?? value ?? '', 'utf8');
			const localVersion = localVersions[name];
			const shouldIncludeIfVersion =
				!forceOverwrite &&
				localState !== null &&
				serverVersionsLoaded &&
				localVersion !== undefined &&
				(conflictMode === 'strict' || !staleKeys.has(name));

			const payload = await buildSecretPayload({
				org: orgId,
				project: projectId,
				env: envName!,
				name,
				plaintext: value,
				keyMaterial: keyInfo.key,
				edPriv,
				ifVersion: shouldIncludeIfVersion ? localVersion : undefined,
				envKekVersion: keyInfo.version,
				envKekFingerprint: keyInfo.fingerprint,
				meta: {
					lineBytes,
					isCommented: Boolean(snapshot?.commented),
				},
			});
			secrets.push(payload);
		}

		spinner.text = 'Uploading encrypted secrets to Ghostable…';
		const sync = Boolean(opts.sync || opts.replace || opts.pruneServer);
		const requestBody = {
			device_id: identity.deviceId,
			secrets,
			force_overwrite: forceOverwrite,
		};
		await client.push(projectId, envName!, requestBody, { sync });

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

		spinner.succeed('Environment pushed securely.');
		log.ok(`✅ Pushed ${secrets.length} variables to ${projectId}:${envName}.`);
	} catch (error) {
		spinner.fail('env:push failed.');

		if (error instanceof HttpError && error.status === 409) {
			const conflicts = parsePushConflicts(error);
			if (conflicts.length) {
				log.error('❌ Push rejected due to version conflicts:');
				for (const conflict of conflicts.slice(0, 10)) {
					log.error(
						`  - ${conflict.key}: local ${formatVersion(conflict.clientIfVersion)} vs server ${formatVersion(conflict.serverVersion)}`,
					);
				}
				if (conflicts.length > 10) {
					log.error('  - …');
				}
				log.error(
					'Run `ghostable env state refresh` and retry, or pass --force-overwrite.',
				);
			}
		}

		log.error(toErrorMessage(error));
		process.exit(1);
	}
}
