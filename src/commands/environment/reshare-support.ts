import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { reshareEnvironmentKey } from '../deploy/token/common.js';

import type { GhostableClient } from '@/ghostable';
import type { DeviceIdentity } from '@/crypto';
import type { Environment } from '@/entities';

export type EnvironmentReshareOutcome = {
	environment: string;
	status: 'reshared' | 'skipped' | 'failed';
	message?: string;
};

type ReshareProjectOptions = {
	client: GhostableClient;
	projectId: string;
	requestedEnvironments?: string[];
	includeAll?: boolean;
	stopOnFailure?: boolean;
};

async function loadIdentity(): Promise<DeviceIdentity> {
	const service = await DeviceIdentityService.create();
	return service.requireIdentity();
}

function normalizeEnvironmentSelection(
	environments: Environment[],
	requestedEnvironments: string[] | undefined,
	includeAll: boolean,
): { selected: Environment[]; missing: string[] } {
	if (includeAll) {
		return { selected: environments, missing: [] };
	}

	const requested = (requestedEnvironments ?? []).map((value) => value.trim()).filter(Boolean);

	if (!requested.length) {
		return { selected: [], missing: [] };
	}

	const byName = new Map(
		environments.map((environment) => [environment.name.toLowerCase(), environment]),
	);
	const byId = new Map(environments.map((environment) => [environment.id, environment]));

	const selected: Environment[] = [];
	const missing: string[] = [];
	for (const value of requested) {
		const match = byId.get(value) ?? byName.get(value.toLowerCase());
		if (match) {
			selected.push(match);
		} else {
			missing.push(value);
		}
	}

	const unique = new Map(selected.map((environment) => [environment.id, environment]));
	return { selected: Array.from(unique.values()), missing };
}

export async function reshareEnvironmentKeysForProject(
	options: ReshareProjectOptions,
): Promise<EnvironmentReshareOutcome[]> {
	const environments = await options.client.getEnvironments(options.projectId);
	const selection = normalizeEnvironmentSelection(
		environments,
		options.requestedEnvironments,
		Boolean(options.includeAll),
	);
	const selected = selection.selected;

	const outcomes: EnvironmentReshareOutcome[] = selection.missing.map((missingEnvironment) => ({
		environment: missingEnvironment,
		status: 'skipped',
		message: 'Environment not found in this project.',
	}));

	if (!selected.length) {
		return outcomes;
	}

	const identity = await loadIdentity();

	for (const environment of selected) {
		try {
			await reshareEnvironmentKey({
				client: options.client,
				projectId: options.projectId,
				envId: environment.id,
				envName: environment.name,
				identity,
			});
			outcomes.push({
				environment: environment.name,
				status: 'reshared',
			});
		} catch (error) {
			const message = toErrorMessage(error);
			outcomes.push({
				environment: environment.name,
				status: 'failed',
				message,
			});
			if (options.stopOnFailure) {
				throw new Error(`Failed to re-share key for ${environment.name}: ${message}`);
			}
		}
	}

	return outcomes;
}

export async function bestEffortReshareForCurrentManifest(client: GhostableClient): Promise<void> {
	let manifestProjectId: string | undefined;
	try {
		manifestProjectId = Manifest.data()?.id;
	} catch {
		return;
	}

	if (!manifestProjectId) {
		return;
	}

	let manifestEnvironmentNames: string[] = [];
	try {
		manifestEnvironmentNames = Manifest.environmentNames();
	} catch {
		return;
	}

	if (!manifestEnvironmentNames.length) {
		return;
	}

	try {
		const outcomes = await reshareEnvironmentKeysForProject({
			client,
			projectId: manifestProjectId,
			requestedEnvironments: manifestEnvironmentNames,
			stopOnFailure: false,
		});

		const reshared = outcomes.filter((outcome) => outcome.status === 'reshared').length;
		const failed = outcomes.filter((outcome) => outcome.status === 'failed');
		if (reshared > 0) {
			log.ok(
				`✅ Re-shared environment keys for ${reshared} environment${reshared === 1 ? '' : 's'}.`,
			);
		}
		for (const entry of failed) {
			log.warn(
				`⚠️ Failed re-sharing key for ${entry.environment}: ${entry.message ?? 'Unknown error'}`,
			);
		}
	} catch (error) {
		log.warn(`⚠️ Automatic key re-share skipped: ${toErrorMessage(error)}`);
	}
}

export async function showPendingReshareRequestsForLinkedDevice(opts: {
	client: GhostableClient;
	organizationId: string;
	deviceId: string;
}): Promise<void> {
	const { client, organizationId, deviceId } = opts;

	try {
		const pending = await client.listOrganizationKeyReshareRequests(organizationId, {
			role: 'recipient',
			status: 'pending',
			deviceId,
			perPage: 100,
		});

		if (!pending.data.length) {
			return;
		}

		const environments = pending.data
			.map((request) => request.environmentName ?? request.environmentId)
			.filter((value): value is string => typeof value === 'string' && value.length > 0);
		const uniqueEnvironments = Array.from(new Set(environments));

		log.warn(
			'⚠️ This device is waiting for environment key re-sharing before it can decrypt data.',
		);
		if (uniqueEnvironments.length > 0) {
			log.info(
				`Pending environment${uniqueEnvironments.length === 1 ? '' : 's'}: ${uniqueEnvironments.join(', ')}`,
			);
		}

		log.info(
			'An organization member with environment manage permissions must fulfill the pending request(s).',
		);
		if (pending.data[0]?.id) {
			log.info(
				`CLI fallback for an actor: ghostable env reshare fulfill ${pending.data[0].id}`,
			);
		}
	} catch (error) {
		log.warn(`⚠️ Could not load pending key re-share status: ${toErrorMessage(error)}`);
	}
}
