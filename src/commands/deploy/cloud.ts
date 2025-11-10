import { Command } from 'commander';
import ora from 'ora';
import path from 'node:path';

import {
	writeEnvFile,
	readEnvFileSafeWithMetadata,
	buildPreservedSnapshot,
} from '@/environment/files/env-files.js';
import {
	createGhostableClient,
	decryptBundle,
	resolveDeployMasterSeed,
	resolveToken,
} from '../../support/deploy-helpers.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveWorkDir } from '../../support/workdir.js';

import type { EnvironmentSecretBundle } from '@/entities';

type DeployCloudOptions = {
	token?: string;
	out?: string;
	only?: string[];
};

async function runDeployCloud(opts: DeployCloudOptions): Promise<void> {
	let masterSeedB64: string;
	try {
		masterSeedB64 = resolveDeployMasterSeed();
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
	}

	// 1) Token + client
	let token: string;
	try {
		token = await resolveToken(opts.token, {
			allowSession: false,
		});
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
	}
	const client = createGhostableClient(token);

	// 2) Fetch bundle for this env (derived from token)
	const spin = ora('Fetching environment secret bundle…').start();
	let bundle: EnvironmentSecretBundle;
	try {
		bundle = await client.deploy({
			includeMeta: true,
			includeVersions: true,
			only: opts.only,
		});
		spin.succeed('Bundle fetched.');
	} catch (error) {
		spin.fail('Failed to fetch bundle.');
		log.error(toErrorMessage(error));
		process.exit(1);
	}

	if (!bundle.secrets.length) {
		log.warn('No secrets returned; nothing to write.');
		return;
	}

	// 3) Decrypt + merge (child wins). (Server currently returns a single layer.)
	const { secrets, warnings } = await decryptBundle(bundle, {
		masterSeedB64,
	});
	for (const w of warnings) log.warn(`⚠️ ${w}`);

	const merged: Record<string, string> = {};
	for (const s of secrets) merged[s.entry.name] = s.value;

	// 4) Write .env in working directory (Cloud flow expects plain .env here)
	const envPath = path.resolve(resolveWorkDir(), '.env');
	const previousMeta = readEnvFileSafeWithMetadata(envPath);
	const previous = previousMeta.vars;
	const combined = { ...previous, ...merged };
	const preserved = buildPreservedSnapshot(previousMeta, merged);
	writeEnvFile(envPath, combined, { preserve: preserved });
	log.ok(`✅ Wrote ${Object.keys(merged).length} keys → ${envPath}`);

	log.ok('Ghostable 👻 deployed (local).');
}

function attachCloudCommand(command: Command): Command {
	return command
		.description('Deploy Ghostable secrets to a Laravel Cloud project')
		.option('--token <TOKEN>', 'Ghostable CI token (or env GHOSTABLE_CI_TOKEN)')
		.option('--out <PATH>', 'Where to write the encrypted blob (default: .env.encrypted)')
		.option('--only <KEY...>', 'Limit to specific keys')
		.action(async (opts: DeployCloudOptions) => {
			await runDeployCloud(opts);
		});
}

export function configureDeployCloudCommand(deploy: Command) {
	attachCloudCommand(deploy.command('cloud'));

	const root = deploy.parent ?? null;
	if (root) {
		attachCloudCommand(root.command('deploy:cloud', { hidden: true }));
	}
}
