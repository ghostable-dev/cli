import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';

import { Manifest } from '../support/Manifest.js';
import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '../services/GhostableClient.js';
import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD } from '../crypto.js';
import { loadOrCreateKeys } from '../keys.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';
import { resolveWorkDir } from '../support/workdir.js';
import { getIgnoredKeys, filterIgnoredKeys } from '../support/ignore.js';

import type { EnvironmentSecret, EnvironmentSecretBundle } from '@/domain';

type PullOptions = {
	token?: string;
	env?: string;
	file?: string; // output path; default .env.<env> or .env
	only?: string[]; // repeatable: --only KEY --only OTHER
	includeMeta?: boolean;
	dryRun?: boolean; // don't write file; just show summary
	showIgnored?: boolean;
};

function resolveOutputPath(envName: string | undefined, explicit?: string): string {
	const workDir = resolveWorkDir();
	if (explicit) return path.resolve(workDir, explicit);
	if (envName) return path.resolve(workDir, `.env.${envName}`);
	return path.resolve(workDir, '.env');
}

function lineForDotenv(name: string, value: string, commented = false): string {
	const safe = value.includes('\n') ? JSON.stringify(value) : value;
	return commented ? `# ${name}=${safe}` : `${name}=${safe}`;
}

export function registerEnvPullCommand(program: Command) {
	program
		.command('env:pull')
		.description('Pull and decrypt environment variables into a local .env file.')
		.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
		.option('--file <PATH>', 'Output file (default: .env.<env> or .env)')
		.option('--token <TOKEN>', 'API token (or stored session / GHOSTABLE_TOKEN)')
		.option('--only <KEY...>', 'Only include these keys')
		.option('--include-meta', 'Include meta flags in bundle', false)
		.option('--dry-run', 'Do not write file; just report', false)
		.option('--show-ignored', 'Display ignored keys', false)
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
				log.error('❌ No environments defined in ghostable.yml.');
				process.exit(1);
			}

			// 2) Pick env (flag → prompt)
			let envName = opts.env?.trim();
			if (!envName) {
				envName = await select<string>({
					message: 'Which environment would you like to pull?',
					choices: envNames.sort().map((n) => ({ name: n, value: n })),
				});
			}

			// 3) Resolve token (org context only affects server-side; decrypt uses AAD)
			let token = opts.token || process.env.GHOSTABLE_TOKEN || '';
			if (!token) {
				const sessionSvc = new SessionService();
				const sess = await sessionSvc.load();
				if (!sess?.accessToken) {
					log.error(
						'❌ No API token. Run `ghostable login` or pass --token / set GHOSTABLE_TOKEN.',
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
					includeMeta: !!opts.includeMeta,
					includeVersions: true,
					only: opts.only,
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
			const keyBundle = await loadOrCreateKeys();
			const masterSeed = Buffer.from(keyBundle.masterSeedB64.replace(/^b64:/, ''), 'base64');

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
					const { encKey } = deriveKeys(masterSeed, scope);

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
			const lines = Object.keys(filteredMerged)
				.sort((a, b) => a.localeCompare(b))
				.map((k) => lineForDotenv(k, filteredMerged[k], filteredComments[k]));

			const outputPath = resolveOutputPath(envName!, opts.file);
			const content = lines.join('\n') + '\n';

			if (opts.dryRun) {
				log.info(
					`Dry run: would write ${Object.keys(filteredMerged).length} keys to ${outputPath}`,
				);
				process.exit(0);
			}

			fs.writeFileSync(outputPath, content, 'utf8');

			log.ok(
				`✅ Wrote ${Object.keys(filteredMerged).length} keys to ${outputPath} (decrypted & merged locally for ${projectName}:${envName}).`,
			);
		});
}
