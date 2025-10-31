import { select } from '@inquirer/prompts';

import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '../../services/GhostableClient.js';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '../../services/EnvironmentKeyService.js';

import type { DeviceIdentity } from '@/crypto';
import type { Environment } from '@/domain';

export type ProjectContext = {
	projectId: string;
	projectName: string;
};

export async function requireProjectContext(): Promise<ProjectContext> {
	try {
		return {
			projectId: Manifest.id(),
			projectName: Manifest.name(),
		};
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
	}
}

export async function requireAuthedClient(): Promise<GhostableClient> {
	const session = await new SessionService().load();
	if (!session?.accessToken) {
		log.error('❌ Not authenticated. Run `ghostable login`.');
		process.exit(1);
	}

	return GhostableClient.unauthenticated(config.apiBase).withToken(session.accessToken);
}

export async function selectEnvironment(
	client: GhostableClient,
	projectId: string,
	requested?: string,
): Promise<Environment> {
	let environments: Environment[] = [];
	try {
		environments = await client.getEnvironments(projectId);
	} catch (error) {
		log.error(`❌ Failed to load environments: ${toErrorMessage(error)}`);
		process.exit(1);
	}

	if (!environments.length) {
		log.error('❌ No environments found for this project.');
		process.exit(1);
	}

	if (requested) {
		const normalized = requested.trim().toLowerCase();
		const match = environments.find(
			(env) => env.name.toLowerCase() === normalized || env.id === requested,
		);
		if (!match) {
			log.error(`❌ Environment '${requested}' not found.`);
			process.exit(1);
		}
		return match;
	}

	const choice = await select<string>({
		message: 'Which environment should the deployment token target?',
		choices: environments
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((env) => ({ name: `${env.name} (${env.type})`, value: env.id })),
	});
	const selected = environments.find((env) => env.id === choice);
	if (!selected) {
		log.error('❌ Invalid environment selection.');
		process.exit(1);
	}
	return selected;
}

export async function requireDeviceIdentity(): Promise<DeviceIdentity> {
	let service: DeviceIdentityService;
	try {
		service = await DeviceIdentityService.create();
	} catch (error) {
		log.error(`❌ Failed to access device identity: ${toErrorMessage(error)}`);
		process.exit(1);
	}

	try {
		return await service.requireIdentity();
	} catch (error) {
		log.error(`❌ ${toErrorMessage(error)}`);
		process.exit(1);
	}
}

export async function reshareEnvironmentKey(opts: {
	client: GhostableClient;
	projectId: string;
	envName: string;
	identity: DeviceIdentity;
}): Promise<void> {
	const { client, projectId, envName, identity } = opts;

	let keyService: EnvironmentKeyService;
	try {
		keyService = await EnvironmentKeyService.create();
	} catch (error) {
		log.error(`❌ Failed to access environment keys: ${toErrorMessage(error)}`);
		process.exit(1);
	}

	try {
		const keyInfo = await keyService.ensureEnvironmentKey({
			client,
			projectId,
			envName,
			identity,
		});
		await keyService.publishKeyEnvelopes({
			client,
			projectId,
			envName,
			identity,
			key: keyInfo.key,
			version: keyInfo.version,
			fingerprint: keyInfo.fingerprint,
			created: keyInfo.created,
		});
	} catch (error) {
		log.error(`❌ Failed to share environment key: ${toErrorMessage(error)}`);
		process.exit(1);
	}
}
