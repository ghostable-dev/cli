import { KeyReshareRequiredError, type GhostableClient } from '@/ghostable';
import { log } from '../../support/logger.js';
import { EnvironmentKeyService } from '@/environment/keys/EnvironmentKeyService.js';

type KeyReshareGuidanceOptions = {
	error: unknown;
	client: GhostableClient;
	projectId: string;
	envName: string;
	deviceId: string;
	envKeyService?: EnvironmentKeyService;
};

export async function printKeyReshareGuidance(
	options: KeyReshareGuidanceOptions,
): Promise<boolean> {
	const { error, client, projectId, envName, deviceId } = options;

	if (!(error instanceof KeyReshareRequiredError)) {
		return false;
	}

	const environmentLabel = error.environmentName ?? envName;
	const pendingIds = error.pendingRequestIds;

	log.warn(`⚠️ Access to "${environmentLabel}" is pending environment key re-sharing.`);

	if (pendingIds.length > 0) {
		log.info(
			`Pending request ID${pendingIds.length === 1 ? '' : 's'}: ${pendingIds.join(', ')}`,
		);
	}

	let actorRequestId: string | null = null;
	if (error.organizationId && error.environmentId) {
		try {
			const actorView = await client.listOrganizationKeyReshareRequests(
				error.organizationId,
				{
					role: 'actor',
					status: 'pending',
					environmentId: error.environmentId,
					deviceId,
					perPage: 100,
				},
			);

			for (const request of actorView.data) {
				if (pendingIds.includes(request.id)) {
					actorRequestId = request.id;
					break;
				}
			}
		} catch {
			// Ignore actor lookup failures and continue with recipient guidance.
		}
	}

	let hasLocalKey = false;
	const envKeyService = options.envKeyService;
	if (envKeyService) {
		try {
			hasLocalKey = await envKeyService.hasLocalEnvironmentKey(projectId, envName);
		} catch {
			hasLocalKey = false;
		}
	}

	if (actorRequestId && hasLocalKey) {
		log.ok('✅ You can fulfill this request from this device.');
		log.text(`Run: ghostable env reshare fulfill ${actorRequestId}`);
		return true;
	}

	if (actorRequestId && !hasLocalKey) {
		log.warn(
			'You can manage this environment, but this device does not have the current environment key locally.',
		);
		log.info('Use another authorized device with local key material to run:');
		log.text(`ghostable env reshare fulfill ${actorRequestId}`);
		return true;
	}

	log.info(
		'Waiting for an organization member with environment manage permissions to fulfill this.',
	);
	if (error.organizationId) {
		log.text(
			`Check status with: ghostable env reshare pending --organization ${error.organizationId} --role recipient`,
		);
	}

	return true;
}
