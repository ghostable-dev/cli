import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import fs from 'node:fs';
import path from 'node:path';

import { Manifest } from '../../support/Manifest.js';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD } from '@/crypto';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveWorkDir } from '../../support/workdir.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { registerVarSubcommand } from './_shared.js';
import { promptWithCancel } from '@/support/prompts.js';

import type { EnvironmentSecret } from '@/entities';

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
	registerVarSubcommand(
		program,
		{
			subcommand: 'pull',
			legacy: [{ name: 'var:pull' }],
		},
		(cmd) =>
			cmd
				.description('Pull one environment variable into your local .env')
				.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
				.option(
					'--key <KEY>',
					'Environment variable name (if omitted, select from remote list)',
				)
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
						envName = await promptWithCancel(() =>
							select<string>({
								message: 'Which environment would you like to pull?',
								choices: envNames.sort().map((name) => ({ name, value: name })),
							}),
						);
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

							keyName = await promptWithCancel(() =>
								select<string>({
									message: `Select a variable to pull from ${projectName}/${envName}:`,
									choices: response.data.map((item) => ({
										name: item.name,
										value: item.name,
									})),
								}),
							);
						} catch (error) {
							log.error(
								`❌ Failed to load environment keys: ${toErrorMessage(error)}`,
							);
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

					let identityService: DeviceIdentityService;
					try {
						identityService = await DeviceIdentityService.create();
					} catch (error) {
						log.error(`❌ Failed to access device identity: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					let identity;
					try {
						identity = await identityService.requireIdentity();
					} catch (error) {
						log.error(`❌ Failed to load device identity: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					let envKeyService: EnvironmentKeyService;
					try {
						envKeyService = await EnvironmentKeyService.create();
					} catch (error) {
						log.error(`❌ Failed to access environment keys: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					const envKeys = new Map<string, Uint8Array>();
					const envs = new Set<string>();
					for (const layer of bundle.chain) {
						envs.add(layer);
					}
					for (const entry of bundle.secrets) {
						envs.add(entry.env);
					}

					for (const env of envs) {
						try {
							const { key } = await envKeyService.ensureEnvironmentKey({
								client,
								projectId,
								envName: env,
								identity,
							});
							envKeys.set(env, key);
						} catch (error) {
							log.error(
								`❌ Failed to load environment key for ${env}: ${toErrorMessage(error)}`,
							);
							process.exit(1);
							return;
						}
					}

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
							const keyMaterial = envKeys.get(entry.env);
							if (!keyMaterial) {
								log.warn(
									`⚠️ Missing decryption key for ${entry.env}; skipping ${entry.name}`,
								);
								continue;
							}
							const { encKey } = deriveKeys(keyMaterial, scope);

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
						path.relative(resolveWorkDir(), resolvedPath) ||
						path.basename(resolvedPath);
					log.ok(`✅ Updated ${keyName} in ${relPath}`);
				}),
	);
}
