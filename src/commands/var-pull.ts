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

import type { EnvironmentSecret } from '@/domain';

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

type VarPullOptions = {
	token?: string;
	env?: string;
	file?: string;
	key?: string;
};

function escapeRegExp(value: string): string {
	return value.replace(ESCAPE_REGEX, '\\$&');
}

function lineForDotenv(name: string, value: string, commented = false): string {
	const safe = value.includes('\n') ? JSON.stringify(value) : value;
	return commented ? `# ${name}=${safe}` : `${name}=${safe}`;
}

function resolveOutputPath(envName: string | undefined, explicit?: string): string {
	const workDir = resolveWorkDir();
	if (explicit) return path.resolve(workDir, explicit);
	if (envName) return path.resolve(workDir, `.env.${envName}`);
	return path.resolve(workDir, '.env');
}

function upsertEnvValue(filePath: string, key: string, value: string, commented: boolean): void {
	const line = lineForDotenv(key, value, commented);
	let content = '';

	if (fs.existsSync(filePath)) {
		content = fs.readFileSync(filePath, 'utf8');
	}

	const pattern = new RegExp(`^\\s*#?\\s*${escapeRegExp(key)}\\s*=.*$`, 'm');
	if (pattern.test(content)) {
		content = content.replace(pattern, line);
	} else {
		const trimmed = content.replace(/\s*$/, '');
		content = trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
	}

	if (!content.endsWith('\n')) {
		content += '\n';
	}

	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, 'utf8');
}

export function registerVarPullCommand(program: Command) {
	program
		.command('var:pull')
		.description('Pull and decrypt a single environment variable into a local .env file.')
		.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
		.option('--key <KEY>', 'Environment variable name (if omitted, select from remote list)')
		.option('--file <PATH>', 'Output file (default: .env.<env> or .env)')
		.option('--token <TOKEN>', 'API token (or stored session / GHOSTABLE_TOKEN)')
		.action(async (opts: VarPullOptions) => {
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
				envName = await select<string>({
					message: 'Which environment would you like to pull?',
					choices: envNames.sort().map((name) => ({ name, value: name })),
				});
			}

			let token = opts.token || process.env.GHOSTABLE_TOKEN || '';
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
			}

			const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);

			let keyName = opts.key?.trim();
			if (!keyName) {
				try {
					const response = await client.getEnvironmentKeys(projectId, envName!);
					if (!response.data.length) {
						log.warn(`No variables found for environment "${envName}".`);
						return;
					}

					keyName = await select<string>({
						message: `Select a variable to pull from ${projectName}/${envName}:`,
						choices: response.data.map((item) => ({
							name: item.name,
							value: item.name,
						})),
					});
				} catch (error) {
					log.error(`❌ Failed to load environment keys: ${toErrorMessage(error)}`);
					process.exit(1);
					return;
				}
			}

			let bundle;
			try {
				bundle = await client.pull(projectId, envName!, {
					includeMeta: true,
					includeVersions: true,
					only: [keyName!],
				});
			} catch (error) {
				log.error(`❌ Failed to pull variable: ${toErrorMessage(error)}`);
				process.exit(1);
				return;
			}

			if (!bundle.secrets.length) {
				log.warn(`Variable "${keyName}" was not found on the server.`);
				return;
			}

			await initSodium();
			const keyBundle = await loadOrCreateKeys();
			const masterSeed = Buffer.from(keyBundle.masterSeedB64.replace(/^b64:/, ''), 'base64');

			const chainOrder: readonly string[] = bundle.chain;
			const byEnv = new Map<string, EnvironmentSecret[]>();
			for (const entry of bundle.secrets) {
				if (!byEnv.has(entry.env)) byEnv.set(entry.env, []);
				byEnv.get(entry.env)!.push(entry);
			}

			const values = new Map<string, string>();
			const commentFlags = new Map<string, boolean>();

			for (const layer of chainOrder) {
				const entries: EnvironmentSecret[] = byEnv.get(layer) || [];
				for (const entry of entries) {
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
						values.set(entry.name, value);
						commentFlags.set(entry.name, Boolean(entry.meta?.is_commented));
					} catch {
						log.warn(`⚠️ Could not decrypt ${entry.name}; skipping`);
					}
				}
			}

			if (!values.has(keyName!)) {
				log.warn(`Variable "${keyName}" could not be decrypted.`);
				return;
			}

			const resolvedPath = resolveOutputPath(envName!, opts.file);
			const value = values.get(keyName!)!;
			const commented = commentFlags.get(keyName!) ?? false;

			upsertEnvValue(resolvedPath, keyName!, value, commented);

			const relPath =
				path.relative(resolveWorkDir(), resolvedPath) || path.basename(resolvedPath);
			log.ok(`✅ Updated ${keyName} in ${relPath}`);
		});
}
