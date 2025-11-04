import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '../../services/GhostableClient.js';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';

export type AuthedClient = { client: GhostableClient };
export type LinkedIdentity = Awaited<ReturnType<DeviceIdentityService['requireIdentity']>>;

export async function getAuthedClient(): Promise<AuthedClient> {
	const session = await new SessionService().load();
	if (!session?.accessToken) {
		log.error('❌ Not authenticated. Run `ghostable login`.');
		process.exit(1);
	}

	const client = GhostableClient.unauthenticated(config.apiBase).withToken(session.accessToken);
	return { client };
}

export async function ensureDeviceService(): Promise<DeviceIdentityService> {
	return DeviceIdentityService.create();
}
