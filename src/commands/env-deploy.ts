import { Command } from 'commander';
import ora from 'ora';
import path from 'node:path';

import { writeEnvFile, readEnvFileSafe } from '../support/env-files.js';
import { createGhostableClient, decryptBundle, resolveToken } from '../support/deploy-helpers.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import { resolveWorkDir } from '../support/workdir.js';
import { setMasterSeed } from '../keys.js';
import { config } from '../config/index.js';

import type { EnvironmentSecretBundle } from '@/domain';

type EnvDeployOptions = {
	token?: string;
	file?: string; // default: .env
	only?: string[]; // limit to specific keys
	api?: string; // optional override of API base
};

export function registerEnvDeployCommand(program: Command) {
	program
		.command('env:deploy')
		.description('Fetch Ghostable env vars and write a local .env file (provider-agnostic).')
		.option('--token <TOKEN>', 'Ghostable CI token (or env GHOSTABLE_CI_TOKEN)')
		.option('--file <PATH>', 'Output file (default: .env)')
		.option('--only <KEY...>', 'Only include these keys')
		.option('--api <URL>', 'Ghostable API base', config.apiBase)
		.action(async (opts: EnvDeployOptions) => {
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
			const client = createGhostableClient(token, opts.api);

			// 2) Fetch bundle (environment is implied by the CI token context)
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

			// 3) Decrypt and merge (child wins if multiple layers are ever present)
			const { secrets, warnings } = await decryptBundle(bundle);
			for (const w of warnings) log.warn(`⚠️ ${w}`);

			const merged: Record<string, string> = {};
			for (const s of secrets) merged[s.entry.name] = s.value;

			// 4) Write .env (default) or a custom path
			const workDir = resolveWorkDir();
			const outPath = path.resolve(workDir, opts.file ?? '.env');
			const previous = readEnvFileSafe(outPath);
			const combined = { ...previous, ...merged };

			writeEnvFile(outPath, combined);
			log.ok(`✅ Wrote ${Object.keys(merged).length} keys → ${outPath}`);
			log.ok('Ghostable 👻 deployed (local).');
		});
}
