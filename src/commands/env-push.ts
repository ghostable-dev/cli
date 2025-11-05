import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import fs from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';

import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { DeviceIdentityService } from '../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '../services/EnvironmentKeyService.js';
import { Manifest } from '../support/Manifest.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import { getIgnoredKeys, filterIgnoredKeys } from '../support/ignore.js';
import { resolveEnvFile, readEnvFileSafeWithMetadata } from '../support/env-files.js';
import { initSodium } from '@/crypto';
import { loadOrCreateKeys } from '@/keychain';
import { buildSecretPayload } from '../support/secret-payload.js';
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
};

export function registerEnvPushCommand(program: Command) {
	program
		.command('env:push')
		.description(
			'Encrypt and push a local .env file to Ghostable (uses .ghostable/ghostable.yaml)',
		)
		.option('--file <PATH>', 'Path to .env file (default: .env.<env> or .env)')
		.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
		.option('-y, --assume-yes', 'Skip confirmation prompts', false)
		.option('--sync', 'Prune server variables not present locally', false)
		.option('--replace', 'Alias for --sync', false)
		.option('--prune-server', 'Alias for --sync', false)
		.action(async (opts: PushOptions) => runEnvPush(opts));
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
	const sess = await sessionSvc.load();
	if (!sess?.accessToken) {
		log.error('❌ No API token. Run `ghostable login`.');
		process.exit(1);
	}
	const token = sess.accessToken;
	const orgId = sess.organizationId;

	// 4) Resolve .env file path
	const filePath = resolveEnvFile(envName!, opts.file, true);
	if (!fs.existsSync(filePath)) {
		log.error(`❌ .env file not found at ${filePath}`);
		process.exit(1);
	}

	// 5) Read variables + apply ignore list
	const { vars: envMap } = readEnvFileSafeWithMetadata(filePath);
	const ignored = getIgnoredKeys(envName);
	const filteredVars = filterIgnoredKeys(envMap, ignored);
	const entryCount = Object.keys(filteredVars).length;
	if (!entryCount) {
		log.warn('⚠️  No variables found in the .env file.');
		return;
	}

	if (!opts.assumeYes) {
		log.info(
			`About to push ${entryCount} variables from ${chalk.bold(filePath)}\n` +
				`→ project ${chalk.bold(projectName)} (${projectId})\n` +
				(orgId ? `→ org ${chalk.bold(orgId)}\n` : ''),
		);
	}

	const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);

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
		const keyBundle = await loadOrCreateKeys();
		const edPriv = Buffer.from(keyBundle.ed25519PrivB64.replace(/^b64:/, ''), 'base64');

		const secrets = [] as SignedEnvironmentSecretUploadRequest[];
		const sortedKeys = Object.keys(filteredVars).sort((a, b) => a.localeCompare(b));
		for (const name of sortedKeys) {
			const value = filteredVars[name] ?? '';
			const payload = await buildSecretPayload({
				org: orgId ?? '',
				project: projectId,
				env: envName!,
				name,
				plaintext: value,
				keyMaterial: keyInfo.key,
				edPriv,
				envKekVersion: keyInfo.version,
				envKekFingerprint: keyInfo.fingerprint,
			});
			secrets.push(payload);
		}

		spinner.text = 'Uploading encrypted secrets to Ghostable…';
		const sync = Boolean(opts.sync || opts.replace || opts.pruneServer);
		await client.push(projectId, envName!, { secrets }, { sync });

		spinner.succeed('Environment pushed securely.');
		log.ok(`✅ Pushed ${secrets.length} variables to ${projectId}:${envName}.`);
	} catch (error) {
		spinner.fail('env:push failed.');
		log.error(toErrorMessage(error));
		process.exit(1);
	}
}
