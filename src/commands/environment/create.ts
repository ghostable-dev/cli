import { Command } from 'commander';
import { select, input } from '@inquirer/prompts';
import ora from 'ora';
import chalk from 'chalk';

import { Manifest } from '../../support/Manifest.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { config } from '../../config/index.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { registerEnvSubcommand } from './_shared.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { buildSecretPayload } from '../../support/secret-payload.js';
import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD } from '@/crypto';

import type {
	EnvironmentType,
	EnvironmentSuggestedName,
	Environment,
	EnvironmentSecret,
	EnvironmentSecretBundle,
} from '@/entities';
import type { Session } from '@/types';

import type { SignedEnvironmentSecretUploadRequest } from '@/ghostable/types/environment.js';

type CreationMode = 'scratch' | 'duplicate';

type DuplicateEnvironmentSecretsParams = {
	client: GhostableClient;
	projectId: string;
	orgId: string;
	sourceEnv: Environment;
	targetEnv: Environment;
};

export function registerEnvCreateCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'create',
			legacy: [{ name: 'env:init' }],
		},
		(cmd) =>
			cmd
				.description('Create a new environment from scratch or duplicate an existing one')
				.option('--name <NAME>', 'Environment name (slug)')
				.action(async (opts: { name?: string }) => {
					// 1) Ensure session and project context
					const sessionSvc = new SessionService();
					const sess = await sessionSvc.load();
					if (!sess?.accessToken) {
						log.error('❌ Not authenticated. Run `ghostable login`.');
						process.exit(1);
					}

					let projectId: string;
					try {
						projectId = Manifest.id();
					} catch {
						log.error('❌ No project selected. Run `ghostable init` first.');
						process.exit(1);
						return;
					}

					const client = GhostableClient.unauthenticated(config.apiBase).withToken(
						sess.accessToken,
					);

					// 2) Load environments to know if duplication is possible
					const envSpinner = ora('Loading existing environments…').start();
					let envOptions: Environment[] = [];
					try {
						envOptions = await client.getEnvironments(projectId);
						envOptions.sort((a, b) => a.name.localeCompare(b.name));
						envSpinner.succeed(`Loaded ${envOptions.length} existing environments.`);
					} catch (error) {
						envSpinner.fail('Failed to load existing environments.');
						log.error(toErrorMessage(error));
						process.exit(1);
					}

					let creationMode: CreationMode = 'scratch';
					if (envOptions.length) {
						creationMode = await select<CreationMode>({
							message: 'How would you like to create the environment?',
							choices: [
								{ name: 'Start from scratch', value: 'scratch' },
								{ name: 'Duplicate an existing environment', value: 'duplicate' },
							],
						});
					}

					// 3) Resolve environment type and optional base environment
					let selectedType: string;
					let baseEnvironment: Environment | undefined;

					if (creationMode === 'duplicate') {
						const baseId = await select<string>({
							message: 'Which environment would you like to duplicate?',
							choices: envOptions.map((env) => ({
								name: `${env.name} (${env.type})`,
								value: env.id,
							})),
							pageSize: Math.min(12, Math.max(envOptions.length, 1)),
						});

						baseEnvironment = envOptions.find((env) => env.id === baseId);
						if (!baseEnvironment) {
							log.error('❌ Unable to locate the selected environment to duplicate.');
							process.exit(1);
						}

						selectedType = baseEnvironment.type;
					} else {
						const typesSpinner = ora('Loading environment types…').start();
						let typeOptions: EnvironmentType[] = [];
						try {
							typeOptions = await client.getEnvironmentTypes();
							typesSpinner.succeed(`Loaded ${typeOptions.length} environment types.`);
						} catch (error) {
							typesSpinner.fail('Failed to load environment types.');
							log.error(toErrorMessage(error));
							process.exit(1);
						}

						selectedType = await select<string>({
							message: 'What type of environment are you creating?',
							choices: typeOptions.map((t) => ({
								name: t.label(),
								value: t.value,
							})),
							pageSize: Math.min(12, typeOptions.length || 1),
						});
					}

					// 4) Name (option > suggestions > custom)
					let name: string | undefined = opts.name;
					if (!name) {
						const suggestSpinner = ora('Fetching suggested environment names…').start();
						let suggestions: EnvironmentSuggestedName[] = [];
						try {
							suggestions = await client.suggestEnvironmentNames(
								projectId,
								selectedType,
							);
							suggestSpinner.succeed();
						} catch {
							suggestSpinner.stop();
						}

						if (suggestions.length) {
							const suggestionChoices = [
								...suggestions.map((s) => ({
									name: s.name,
									value: s.name,
								})),
								{
									name: 'Custom name',
									value: '__CUSTOM__',
								},
							];

							const choice = await select<string>({
								message:
									'Choose an environment name or enter a custom one (must be unique and slug formatted)',
								choices: suggestionChoices,
								pageSize: Math.min(12, suggestionChoices.length || 1),
							});

							name =
								choice === '__CUSTOM__'
									? await input({
											message:
												'Enter a unique slug-formatted environment name:',
											validate: (v) =>
												/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v) ||
												'Use slug format (lowercase, digits, -, _).',
										})
									: choice;
						} else {
							name = await input({
								message: 'Enter a unique slug-formatted environment name:',
								validate: (v) =>
									/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v) ||
									'Use slug format (lowercase, digits, -, _).',
							});
						}
					}

					// 5) Create (or duplicate) the environment record
					const actionVerb =
						baseEnvironment !== undefined
							? `Creating environment "${name}" based on "${baseEnvironment.name}"`
							: `Creating environment "${name}"`;
					const createSpinner = ora(`${actionVerb}…`).start();
					let createdEnv: Environment;
					try {
						createdEnv = await client.createEnvironment({
							projectId,
							name: name!,
							type: selectedType,
							baseId: null,
						});
						createSpinner.succeed(`Environment "${createdEnv.name}" created.`);
					} catch (error) {
						createSpinner.fail('Failed creating environment.');
						log.error(toErrorMessage(error));
						process.exit(1);
						return;
					}

					// 6) Update manifest locally immediately so the env is tracked even if cloning fails
					Manifest.addEnvironment({
						name: createdEnv.name,
						type: createdEnv.type,
					});

					if (baseEnvironment) {
						const orgIdSpinner = ora('Resolving organization context…').start();
						let orgId: string;
						try {
							orgId = await resolveOrgId(sess, client, projectId);
							orgIdSpinner.succeed();
						} catch (error) {
							orgIdSpinner.fail('Failed to resolve organization.');
							log.error(toErrorMessage(error));
							process.exit(1);
						}

						const cloneSpinner = ora(
							`Copying secrets from "${baseEnvironment.name}" into "${createdEnv.name}"…`,
						).start();
						try {
							const copied = await duplicateEnvironmentSecrets({
								client,
								projectId,
								orgId,
								sourceEnv: baseEnvironment,
								targetEnv: createdEnv,
							});
							const resultMsg = copied
								? `Copied ${copied} secrets from ${baseEnvironment.name}.`
								: `No secrets to copy from ${baseEnvironment.name}.`;
							cloneSpinner.succeed(resultMsg);
						} catch (error) {
							cloneSpinner.fail('Failed to copy secrets.');
							log.error(toErrorMessage(error));
							process.exit(1);
						}
					}

					log.ok(
						`✅ Environment ${chalk.bold(createdEnv.name)} added to .ghostable/ghostable.yaml`,
					);
				}),
	);
}

async function resolveOrgId(
	sess: Session | null,
	client: GhostableClient,
	projectId: string,
): Promise<string> {
	if (sess?.organizationId) {
		return sess.organizationId;
	}

	const project = await client.getProject(projectId);
	if (!project.organizationId) {
		throw new Error('Project is missing an organization context.');
	}

	return project.organizationId;
}

async function duplicateEnvironmentSecrets({
	client,
	projectId,
	orgId,
	sourceEnv,
	targetEnv,
}: DuplicateEnvironmentSecretsParams): Promise<number> {
	const bundle: EnvironmentSecretBundle = await client.pull(projectId, sourceEnv.name, {
		includeMeta: true,
		includeVersions: true,
	});

	await initSodium();

	const deviceService = await DeviceIdentityService.create();
	const identity = await deviceService.requireIdentity();
	const envKeyService = await EnvironmentKeyService.create();

	const envNames = new Set<string>(bundle.chain);
	for (const entry of bundle.secrets) {
		envNames.add(entry.env);
	}

	const envKeys = new Map<string, Uint8Array>();
	for (const envName of envNames) {
		const { key } = await envKeyService.ensureEnvironmentKey({
			client,
			projectId,
			envName,
			identity,
		});
		envKeys.set(envName, key);
	}

	const merged = decryptBundle(bundle, envKeys);
	const secretNames = Object.keys(merged);
	if (!secretNames.length) {
		return 0;
	}

	const targetKey = await envKeyService.ensureEnvironmentKey({
		client,
		projectId,
		envName: targetEnv.name,
		identity,
	});

	if (targetKey.created) {
		await envKeyService.publishKeyEnvelopes({
			client,
			projectId,
			envId: targetEnv.id,
			envName: targetEnv.name,
			identity,
			key: targetKey.key,
			version: targetKey.version,
			fingerprint: targetKey.fingerprint,
			created: true,
		});
	}

	const edPriv = Buffer.from(identity.signingKey.privateKey, 'base64');
	const plaintextSecrets = secretNames.sort((a, b) => a.localeCompare(b));
	const payloads: SignedEnvironmentSecretUploadRequest[] = [];
	for (const name of plaintextSecrets) {
		const payload = await buildSecretPayload({
			org: orgId,
			project: projectId,
			env: targetEnv.name,
			name,
			plaintext: merged[name],
			keyMaterial: targetKey.key,
			edPriv,
			envKekVersion: targetKey.version,
			envKekFingerprint: targetKey.fingerprint,
		});
		payloads.push(payload);
	}

	await client.push(
		projectId,
		targetEnv.name,
		{ device_id: identity.deviceId, secrets: payloads },
		{ sync: true },
	);

	return payloads.length;
}

function decryptBundle(
	bundle: EnvironmentSecretBundle,
	envKeys: Map<string, Uint8Array>,
): Record<string, string> {
	const chainOrder = bundle.chain;
	const byEnv = new Map<string, EnvironmentSecret[]>();
	for (const entry of bundle.secrets) {
		if (!byEnv.has(entry.env)) {
			byEnv.set(entry.env, []);
		}
		byEnv.get(entry.env)!.push(entry);
	}

	const merged: Record<string, string> = {};
	const decoder = new TextDecoder();

	for (const layer of chainOrder) {
		const entries = byEnv.get(layer) || [];
		for (const entry of entries) {
			if (!entry.aad) {
				throw new Error(`Secret ${entry.name} is missing associated data.`);
			}
			const keyMaterial = envKeys.get(entry.env);
			if (!keyMaterial) {
				throw new Error(`Missing decryption key for environment ${entry.env}.`);
			}

			const scope = scopeFromAAD(entry.aad);
			const { encKey } = deriveKeys(keyMaterial, scope);
			const plaintext = aeadDecrypt(encKey, {
				alg: entry.alg,
				nonce: entry.nonce,
				ciphertext: entry.ciphertext,
				aad: entry.aad,
			});
			merged[entry.name] = decoder.decode(plaintext);
		}
	}

	return merged;
}
