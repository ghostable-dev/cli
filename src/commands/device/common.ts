import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '../../services/GhostableClient.js';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import type { OneTimePrekey } from '@/crypto';
import type { DevicePrekeyBundle } from '@/types';

export const DEFAULT_PREKEY_BATCH = 20;

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

export async function persistOneTimePrekeys(
        service: DeviceIdentityService,
        bundle: DevicePrekeyBundle,
): Promise<void> {
        const prekeys = bundle.oneTimePrekeys;
        const existing = await service.loadOneTimePrekeys();
        const serverIds = new Set(prekeys.map((p) => p.id));

        for (const stale of existing) {
                if (!serverIds.has(stale.id)) {
                        await service.getKeyStore().deleteKey(`oneTimePrekey:${stale.id}`);
                }
        }

        const withPriv: OneTimePrekey[] = [];
        for (const prekey of prekeys) {
                const priv = await service.getKeyStore().getKey(`oneTimePrekey:${prekey.id}`);
                withPriv.push({
                        ...prekey,
                        privateKey: priv ? Buffer.from(priv).toString('base64') : undefined,
                });
        }

        await service.saveOneTimePrekeys(withPriv);
}
