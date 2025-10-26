import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import fs from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';

import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '../services/GhostableClient.js';
import { DeviceIdentityService } from '../services/DeviceIdentityService.js';
import { EnvelopeService } from '../services/EnvelopeService.js';
import { Manifest } from '../support/Manifest.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import { getIgnoredKeys, filterIgnoredKeys } from '../support/ignore.js';
import {
	EnvVarSnapshot,
	resolveEnvFile,
	readEnvFileSafeWithMetadata,
} from '../support/env-files.js';

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

function serializeEnv(
	vars: Record<string, string>,
	snapshots: Record<string, EnvVarSnapshot>,
): string {
	return (
		Object.keys(vars)
			.sort((a, b) => a.localeCompare(b))
			.map((key) => {
				const value = vars[key] ?? '';
				const snapshot = snapshots[key];
				if (snapshot && snapshot.value === value) {
					return `${key}=${snapshot.rawValue}`;
				}
				return `${key}=${value}`;
			})
			.join('\n') + '\n'
	);
}

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
	const { vars: envMap, snapshots } = readEnvFileSafeWithMetadata(filePath);
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

	const serialized = serializeEnv(filteredVars, snapshots);
	const plaintext = Buffer.from(serialized, 'utf8');

	if (!plaintext.length) {
		log.warn('⚠️  No variables found in the .env file.');
		return;
	}

	const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);

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
		spinner.text = 'Encrypting environment variables locally…';
		const envelope = await EnvelopeService.encrypt({
			sender: identity,
			recipientPublicKey: identity.encryptionKey.publicKey,
			plaintext,
			meta: {
				project_id: projectId,
				environment: envName!,
				org_id: orgId ?? '',
				file_path: filePath,
			},
		});

		spinner.text = 'Uploading encrypted envelope to Ghostable…';
		const result = await client.sendEnvelope(identity.deviceId, envelope);

		spinner.succeed('Environment pushed securely.');
		const ciphertextBytes = Buffer.from(envelope.ciphertextB64, 'base64').byteLength;
		log.ok(
			`✅ Envelope ${result.id} uploaded (${ciphertextBytes} encrypted bytes for ${projectId}:${envName}).`,
		);
	} catch (error) {
		console.log(error);
		spinner.fail('env:push failed.');
		log.error(toErrorMessage(error));
		process.exit(1);
	}
}
