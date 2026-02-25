import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';

export type AuthedClient = { client: GhostableClient };
export type LinkedIdentity = Awaited<ReturnType<DeviceIdentityService['requireIdentity']>>;

export async function getAuthedClient(): Promise<AuthedClient> {
	const tokenFromEnv = process.env.GHOSTABLE_TOKEN?.trim() || '';
	const session = tokenFromEnv ? null : await new SessionService().load();
	const token = tokenFromEnv || session?.accessToken || '';
	if (!token) {
		log.error('❌ Not authenticated. Run `ghostable login` or set GHOSTABLE_TOKEN.');
		process.exit(1);
	}

	const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);
	return { client };
}

export async function ensureDeviceService(): Promise<DeviceIdentityService> {
	return DeviceIdentityService.create();
}
