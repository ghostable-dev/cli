import { Command } from 'commander';
import ora from 'ora';
import path from 'node:path';

import { writeEnvFile, readEnvFileSafe } from '../support/env-files.js';
import { createGhostableClient, decryptBundle, resolveToken } from '../support/deploy-helpers.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import { resolveWorkDir } from '../support/workdir.js';

import { setMasterSeed } from '../keys.js';
import type { EnvironmentSecretBundle } from '@/domain';

export function registerDeployCloudCommand(program: Command) {
	program
		.command('deploy:cloud')
		.description('Deploy Ghostable managed environment variables for Laravel Cloud.')
		.option('--token <TOKEN>', 'Ghostable CI token (or env GHOSTABLE_CI_TOKEN)')
		.option('--out <PATH>', 'Where to write the encrypted blob (default: .env.encrypted)')
		.option('--only <KEY...>', 'Limit to specific keys')
		.action(async (opts: { token?: string; out?: string; only?: string[] }) => {
			const seedFromEnv = process.env.GHOSTABLE_MASTER_SEED?.trim();
			if (seedFromEnv) {
				try {
					await setMasterSeed(seedFromEnv);
				} catch {
					log.warn('⚠️ Failed to import master seed from GHOSTABLE_MASTER_SEED.');
				}
			}

			// 1) Token + client
			let token: string;
			try {
				token = await resolveToken(opts.token);
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
			const { secrets, warnings } = await decryptBundle(bundle);
			for (const w of warnings) log.warn(`⚠️ ${w}`);

			const merged: Record<string, string> = {};
			for (const s of secrets) merged[s.entry.name] = s.value;

			// 4) Write .env in working directory (Cloud flow expects plain .env here)
			const envPath = path.resolve(resolveWorkDir(), '.env');
			const previous = readEnvFileSafe(envPath);
			const combined = { ...previous, ...merged };
			writeEnvFile(envPath, combined);
			log.ok(`✅ Wrote ${Object.keys(merged).length} keys → ${envPath}`);

			log.ok('Ghostable 👻 deployed (local).');
		});
}
