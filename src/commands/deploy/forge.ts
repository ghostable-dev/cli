import { Command } from 'commander';
import ora from 'ora';
import path from 'node:path';
import fs from 'node:fs';

import { b64, randomBytes } from '@/crypto';
import {
	writeEnvFile,
	readEnvFileSafeWithMetadata,
	buildPreservedSnapshot,
} from '@/environment/files/env-files.js';
import { artisan } from '../../support/artisan.js';
import {
	createGhostableClient,
	decryptBundle,
	resolveDeployMasterSeed,
	resolveToken,
} from '../../support/deploy-helpers.js';
import { fetchDeployBundleWithCache, formatCacheAge } from '../../support/deploy-cache.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveWorkDir } from '../../support/workdir.js';
import type { EnvironmentSecretBundle } from '@/entities';

type DeployForgeOptions = {
	token?: string;
	encrypted?: boolean;
	out?: string;
	only?: string[];
	allowStaleCache?: boolean;
};

async function runDeployForge(opts: DeployForgeOptions): Promise<void> {
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
	const deploySpin = ora('Fetching environment secret bundle…').start();
	let bundle: EnvironmentSecretBundle;
	try {
		const fetched = await fetchDeployBundleWithCache({
			client,
			token,
			only: opts.only,
			allowStaleCache: opts.allowStaleCache,
		});
		bundle = fetched.bundle;
		if (fetched.source === 'live') {
			deploySpin.succeed('Bundle fetched.');
		} else {
			deploySpin.succeed(
				`Bundle loaded from stale cache (${formatCacheAge(fetched.cacheAgeSeconds ?? 0)} old).`,
			);
			log.warn(
				`⚠️ Using stale encrypted cache due to Ghostable availability issue. Cache: ${fetched.cachePath}`,
			);
		}
	} catch (error) {
		deploySpin.fail('Failed to fetch bundle.');
		log.error(toErrorMessage(error));
		process.exit(1);
	}

	if (!bundle.secrets.length) {
		log.warn('No secrets returned; nothing to write.');
		return;
	}

	// 3) Decrypt + merge (child wins)
	const { secrets, warnings } = await decryptBundle(bundle, {
		masterSeedB64,
	});
	for (const warning of warnings) log.warn(`⚠️ ${warning}`);

	const merged: Record<string, string> = {};
	for (const s of secrets) merged[s.entry.name] = s.value;

	// 4) Write .env in working directory (Forge flow expects plain .env here)
	const workDir = resolveWorkDir();
	const envPath = path.resolve(workDir, '.env');
	const previousMeta = readEnvFileSafeWithMetadata(envPath);
	const previous = previousMeta.vars;
	const combined = { ...previous, ...merged };
	const preserved = buildPreservedSnapshot(previousMeta, merged);

	writeEnvFile(envPath, combined, { preserve: preserved });
	log.ok(`✅ Wrote ${Object.keys(merged).length} keys → ${envPath}`);

	// 5) If --encrypted, generate base64 key, run php artisan env:encrypt, and persist key in .env
	if (opts.encrypted) {
		if (!artisan.exists()) {
			log.error('❌ php or artisan not found. Run inside a Laravel project.');
			process.exit(1);
		}

		const cwd = workDir;
		const outFile = path.resolve(cwd, opts.out ?? `.env.encrypted`);

		const envKeyB64 = `base64:${b64(randomBytes(32))}`;

		// ensure key is present in the plain .env file
		combined['LARAVEL_ENV_ENCRYPTION_KEY'] = envKeyB64;
		writeEnvFile(envPath, combined, {
			preserve: preserved,
		});
		log.ok(`🔑 Set LARAVEL_ENV_ENCRYPTION_KEY in ${path.basename(envPath)}`);

		// Create encrypted blob using Laravel's own command
		const encSpin = ora('Encrypting .env via php artisan env:encrypt…').start();
		try {
			artisan.run(['env:encrypt', '--force', `--key=${envKeyB64}`]);
			encSpin.succeed('Encrypted .env created via Artisan.');
		} catch (err) {
			encSpin.fail('Artisan encryption failed.');
			log.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		}

		const produced = path.join(cwd, '.env.encrypted');
		if (!fs.existsSync(produced)) {
			encSpin.fail('Expected .env.encrypted not found.');
			process.exit(1);
		}

		fs.renameSync(produced, outFile);
		encSpin.succeed(`Encrypted blob → ${path.relative(cwd, outFile)}`);
	}

	log.ok('Ghostable 👻 deployed (local).');
}

function attachForgeCommand(command: Command): Command {
	return command
		.description('Deploy Ghostable secrets to a Laravel Forge project')
		.option('--token <TOKEN>', 'Ghostable CI token (or env GHOSTABLE_CI_TOKEN)')
		.option('--encrypted', 'Also produce an encrypted blob via php artisan env:encrypt', false)
		.option('--out <PATH>', 'Where to write the encrypted blob (default: .env.encrypted)')
		.option('--only <KEY...>', 'Limit to specific keys')
		.option(
			'--allow-stale-cache',
			'Allow stale encrypted cache fallback (<=24h) when Ghostable is unavailable',
			false,
		)
		.action(async (opts: DeployForgeOptions) => {
			await runDeployForge(opts);
		});
}

export function configureDeployForgeCommand(deploy: Command) {
	attachForgeCommand(deploy.command('forge'));

	const root = deploy.parent ?? null;
	if (root) {
		attachForgeCommand(root.command('deploy:forge', { hidden: true }));
	}
}
