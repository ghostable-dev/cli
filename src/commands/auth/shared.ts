import { select } from '@inquirer/prompts';
import type { GhostableClient } from '@/ghostable';
import type { SessionService } from '../../services/SessionService.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { linkDeviceFlow } from '../device/index.js';
import {
	bestEffortReshareForCurrentManifest,
	showPendingReshareRequestsForLinkedDevice,
} from '../environment/reshare-support.js';

export async function finalizeAuthentication(
	token: string,
	client: GhostableClient,
	session: SessionService,
): Promise<void> {
	const authed = client.withToken(token);
	const orgs = await authed.organizations();

	let organizationId: string | undefined;
	if (orgs.length === 1) {
		organizationId = orgs[0].id;
		log.ok(`✅ Using organization: ${orgs[0].label()}`);
	} else if (orgs.length > 1) {
		organizationId = await select({
			message: 'Choose your organization',
			choices: orgs.map((o) => ({
				name: o.label(),
				value: o.id,
			})),
		});
		log.ok(`✅ Using organization: ${orgs.find((o) => o.id === organizationId)?.label()}`);
	} else {
		log.warn('No organizations found. Create one in the dashboard.');
	}

	await session.save({ accessToken: token, organizationId });
	log.ok('✅ Session stored in OS keychain.');

	try {
		await linkDeviceFlow(authed);
	} catch (deviceError) {
		log.warn(
			`⚠️ Device provisioning skipped: ${toErrorMessage(deviceError) ?? String(deviceError)}`,
		);
	}

	if (organizationId) {
		try {
			const identityService = await DeviceIdentityService.create();
			const identity = await identityService.loadIdentity();
			if (identity?.deviceId) {
				await showPendingReshareRequestsForLinkedDevice({
					client: authed,
					organizationId,
					deviceId: identity.deviceId,
				});
			}
		} catch (error) {
			log.warn(`⚠️ Could not check pending key re-share status: ${toErrorMessage(error)}`);
		}
	}

	await bestEffortReshareForCurrentManifest(authed);
}
