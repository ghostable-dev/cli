import { Command } from 'commander';
import { registerEnvSubcommand } from './_shared.js';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import {
	requireAuthedClient,
	requireProjectContext,
	reshareEnvironmentKey,
} from '../deploy/token/common.js';
import {
	reshareEnvironmentKeysForProject,
	showPendingReshareRequestsForLinkedDevice,
} from './reshare-support.js';
import { SessionService } from '../../services/SessionService.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';
import { HttpError, type GhostableClient, type KeyReshareRequestRole } from '@/ghostable';

type ReshareOptions = {
	env: string[];
	all?: boolean;
};

type PendingOptions = {
	organization?: string;
	role?: KeyReshareRequestRole;
};

type FulfillOptions = {
	organization?: string;
};

const RESHARE_EXIT = {
	SUCCESS: 0,
	REQUEST_CLOSED: 20,
	UNAUTHORIZED: 21,
	LOCAL_KEY_UNAVAILABLE: 22,
	FAILURE: 1,
} as const;

export function registerEnvReshareCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'reshare',
		},
		(cmd) => {
			const reshare = cmd
				.description(
					'Re-share environment keys with currently active devices and deployment tokens',
				)
				.option('--env <ENV>', 'Environment name (repeatable)', collectValues, [])
				.option('--all', 'Re-share keys for all environments in this project', false)
				.action(async (opts: ReshareOptions) => runEnvReshare(opts));

			reshare
				.command('pending')
				.description('List pending environment key re-share requests')
				.option(
					'--organization <ORG_ID>',
					'Organization UUID (defaults to current session org)',
				)
				.option('--role <ROLE>', 'Visibility role: actor or recipient', 'actor')
				.action(async (opts: PendingOptions) => runEnvResharePending(opts));

			reshare
				.command('fulfill <requestId>')
				.description('Fulfill a pending environment key re-share request by request ID')
				.option(
					'--organization <ORG_ID>',
					'Organization UUID (defaults to current session org)',
				)
				.action(async (requestId: string, opts: FulfillOptions) =>
					runEnvReshareFulfill(requestId, opts),
				);

			return reshare;
		},
	);
}

function collectValues(value: string, previous: string[]): string[] {
	return [...previous, value];
}

async function resolveOrganizationId(client: GhostableClient, explicit?: string): Promise<string> {
	const organizationId = explicit?.trim();
	if (organizationId) {
		return organizationId;
	}

	const session = await new SessionService().load();
	if (session?.organizationId) {
		return session.organizationId;
	}

	const organizations = await client.organizations();
	if (organizations.length === 1) {
		return organizations[0].id;
	}

	if (organizations.length === 0) {
		throw new Error('No organizations available for this account.');
	}

	throw new Error('Multiple organizations found. Pass --organization <ORG_ID>.');
}

function normalizeRole(value: string | undefined): KeyReshareRequestRole {
	const normalized = (value ?? '').trim().toLowerCase();
	return normalized === 'recipient' ? 'recipient' : 'actor';
}

async function runEnvReshare(opts: ReshareOptions): Promise<void> {
	const context = await requireProjectContext();
	const client = await requireAuthedClient();

	let requestedEnvironments = opts.env ?? [];
	if (!opts.all && requestedEnvironments.length === 0) {
		try {
			requestedEnvironments = Manifest.environmentNames();
		} catch {
			requestedEnvironments = [];
		}
	}

	if (!opts.all && requestedEnvironments.length === 0) {
		log.error('❌ No environments selected. Pass --env <NAME> or use --all.');
		process.exit(RESHARE_EXIT.FAILURE);
	}

	try {
		const outcomes = await reshareEnvironmentKeysForProject({
			client,
			projectId: context.projectId,
			requestedEnvironments,
			includeAll: Boolean(opts.all),
			stopOnFailure: false,
		});

		if (!outcomes.length) {
			log.warn('⚠️ No matching environments found to re-share.');
			return;
		}

		const reshared = outcomes.filter((outcome) => outcome.status === 'reshared');
		const skipped = outcomes.filter((outcome) => outcome.status === 'skipped');
		const failed = outcomes.filter((outcome) => outcome.status === 'failed');

		for (const outcome of reshared) {
			log.ok(`✅ Re-shared key for ${outcome.environment}.`);
		}
		for (const outcome of skipped) {
			log.warn(`⚠️ Skipped ${outcome.environment}: ${outcome.message ?? 'Not available'}`);
		}
		for (const outcome of failed) {
			log.warn(`⚠️ Failed ${outcome.environment}: ${outcome.message ?? 'Unknown error'}`);
		}

		if (failed.length > 0) {
			process.exit(RESHARE_EXIT.FAILURE);
		}
	} catch (error) {
		log.error(`❌ Re-share failed: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.FAILURE);
	}
}

async function runEnvResharePending(opts: PendingOptions): Promise<void> {
	const client = await requireAuthedClient();
	const role = normalizeRole(opts.role);

	let organizationId: string;
	try {
		organizationId = await resolveOrganizationId(client, opts.organization);
	} catch (error) {
		log.error(`❌ Failed to resolve organization: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.FAILURE);
		return;
	}

	try {
		const pending = await client.listOrganizationKeyReshareRequests(organizationId, {
			role,
			status: 'pending',
			perPage: 100,
		});

		if (!pending.data.length) {
			log.info(`No pending key re-share requests visible for role "${role}".`);
			return;
		}

		log.info(
			`Pending key re-share requests (${pending.data.length}) for organization ${organizationId}:`,
		);
		for (const request of pending.data) {
			const environment = request.environmentName ?? request.environmentId;
			const targetUser = request.targetUserEmail ?? request.targetUserId;
			const targetDevice = request.targetDeviceName ?? request.targetDeviceId;
			log.text(
				`- ${request.id} | ${environment} | target: ${targetUser} (${targetDevice}) | key v${request.requiredKeyVersion}`,
			);
		}
	} catch (error) {
		log.error(`❌ Failed to load pending requests: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.FAILURE);
	}
}

async function runEnvReshareFulfill(requestId: string, opts: FulfillOptions): Promise<void> {
	const trimmedRequestId = requestId.trim();
	if (!trimmedRequestId) {
		log.error('❌ Request ID is required.');
		process.exit(RESHARE_EXIT.FAILURE);
		return;
	}

	const client = await requireAuthedClient();

	let organizationId: string;
	try {
		organizationId = await resolveOrganizationId(client, opts.organization);
	} catch (error) {
		log.error(`❌ Failed to resolve organization: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.FAILURE);
		return;
	}

	let request;
	try {
		request = await client.getOrganizationKeyReshareRequest(organizationId, trimmedRequestId);
	} catch (error) {
		if (error instanceof HttpError && error.status === 403) {
			log.error('❌ You are not allowed to access this key re-share request.');
			process.exit(RESHARE_EXIT.UNAUTHORIZED);
			return;
		}

		if (error instanceof HttpError && error.status === 404) {
			log.warn(
				'⚠️ Request was not found. It may already be resolved or belong to another org.',
			);
			process.exit(RESHARE_EXIT.REQUEST_CLOSED);
			return;
		}

		log.error(`❌ Failed to load request: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.FAILURE);
		return;
	}

	if (request.status !== 'pending') {
		log.warn(`⚠️ Request is already ${request.status}.`);
		process.exit(RESHARE_EXIT.REQUEST_CLOSED);
		return;
	}

	const environmentName = request.environmentName;
	if (!environmentName) {
		log.error('❌ Request is missing environment name metadata; cannot fulfill via CLI.');
		process.exit(RESHARE_EXIT.FAILURE);
		return;
	}

	let identityService: DeviceIdentityService;
	try {
		identityService = await DeviceIdentityService.create();
	} catch (error) {
		log.error(`❌ Failed to access device identity: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.LOCAL_KEY_UNAVAILABLE);
		return;
	}

	let identity;
	try {
		identity = await identityService.requireIdentity();
	} catch (error) {
		log.error(`❌ Failed to load device identity: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.LOCAL_KEY_UNAVAILABLE);
		return;
	}

	let actorVisible: boolean;
	try {
		const actorView = await client.listOrganizationKeyReshareRequests(organizationId, {
			role: 'actor',
			status: 'pending',
			environmentId: request.environmentId,
			deviceId: request.targetDeviceId,
			perPage: 100,
		});
		actorVisible = actorView.data.some((entry) => entry.id === trimmedRequestId);
	} catch (error) {
		log.error(`❌ Failed to verify actor permissions: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.FAILURE);
		return;
	}

	if (!actorVisible) {
		log.error('❌ You do not have environment manage permissions to fulfill this request.');
		process.exit(RESHARE_EXIT.UNAUTHORIZED);
		return;
	}

	let envKeyService: EnvironmentKeyService;
	try {
		envKeyService = await EnvironmentKeyService.create();
	} catch (error) {
		log.error(`❌ Failed to access local environment keys: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.LOCAL_KEY_UNAVAILABLE);
		return;
	}

	try {
		await envKeyService.ensureEnvironmentKey({
			client,
			projectId: request.projectId,
			envName: environmentName,
			identity,
		});
	} catch (error) {
		log.error(
			`❌ Local key material is unavailable for ${environmentName}: ${toErrorMessage(error)}`,
		);
		process.exit(RESHARE_EXIT.LOCAL_KEY_UNAVAILABLE);
		return;
	}

	try {
		await reshareEnvironmentKey({
			client,
			projectId: request.projectId,
			envId: request.environmentId,
			envName: environmentName,
			identity,
			requestIds: [trimmedRequestId],
		});
	} catch (error) {
		if (error instanceof HttpError && error.status === 403) {
			log.error('❌ You do not have permission to fulfill this request.');
			process.exit(RESHARE_EXIT.UNAUTHORIZED);
			return;
		}

		log.error(`❌ Failed to fulfill request: ${toErrorMessage(error)}`);
		process.exit(RESHARE_EXIT.FAILURE);
		return;
	}

	await showPendingReshareRequestsForLinkedDevice({
		client,
		organizationId,
		deviceId: identity.deviceId,
	});

	log.ok(`✅ Fulfilled key re-share request ${trimmedRequestId} for ${environmentName}.`);
	process.exit(RESHARE_EXIT.SUCCESS);
}
