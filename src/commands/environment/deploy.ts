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
import { fetchDeployBundleWithCache, formatCacheAge } from '../../support/deploy-cache.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveWorkDir } from '../../support/workdir.js';
import { registerEnvSubcommand } from './_shared.js';

import type { EnvironmentSecretBundle } from '@/entities';

type EnvDeployOptions = {
	token?: string;
	file?: string; // default: .env
	only?: string[]; // limit to specific keys
	allowStaleCache?: boolean;
};

export function registerEnvDeployCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'deploy',
			legacy: [{ name: 'env:deploy' }],
		},
		(cmd) =>
			cmd
				.description('Fetch Ghostable secrets and write a local .env file')
				.option('--token <TOKEN>', 'Ghostable CI token (or env GHOSTABLE_CI_TOKEN)')
				.option('--file <PATH>', 'Output file (default: .env)')
				.option('--only <KEY...>', 'Only include these keys')
				.option(
					'--allow-stale-cache',
					'Allow stale encrypted cache fallback (<=24h) when Ghostable is unavailable',
					false,
				)
				.action(async (opts: EnvDeployOptions) => {
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

					// 2) Fetch bundle (environment is implied by the CI token context)
					const spin = ora('Fetching environment secret bundle…').start();
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
							spin.succeed('Bundle fetched.');
						} else {
							spin.succeed(
								`Bundle loaded from stale cache (${formatCacheAge(fetched.cacheAgeSeconds ?? 0)} old).`,
							);
							log.warn(
								`⚠️ Using stale encrypted cache due to Ghostable availability issue. Cache: ${fetched.cachePath}`,
							);
						}
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
					const { secrets, warnings } = await decryptBundle(bundle, {
						masterSeedB64,
					});
					for (const w of warnings) log.warn(`⚠️ ${w}`);

					const merged: Record<string, string> = {};
					for (const s of secrets) merged[s.entry.name] = s.value;

					// 4) Write .env (default) or a custom path
					const workDir = resolveWorkDir();
					const outPath = path.resolve(workDir, opts.file ?? '.env');
					const previousMeta = readEnvFileSafeWithMetadata(outPath);
					const previous = previousMeta.vars;
					const combined = { ...previous, ...merged };
					const preserved = buildPreservedSnapshot(previousMeta, merged);

					writeEnvFile(outPath, combined, { preserve: preserved });
					log.ok(`✅ Wrote ${Object.keys(merged).length} keys → ${outPath}`);
					log.ok('Ghostable 👻 deployed (local).');
				}),
	);
}
