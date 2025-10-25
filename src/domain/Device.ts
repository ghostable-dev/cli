import type { DeviceResourceJson } from '@/types';

export type DeviceStatus = 'active' | 'revoked';

export class Device {
        constructor(
                public readonly id: string,
                public readonly publicKey: string,
                public readonly platform: string,
                public readonly status: DeviceStatus,
                public readonly createdAt: Date,
                public readonly lastSeenAt: Date | null,
                public readonly revokedAt: Date | null,
        ) {}

        static fromResource(resource: DeviceResourceJson): Device {
                const attrs = resource.attributes;
                return new Device(
                        resource.id,
                        attrs.public_key,
                        attrs.platform,
                        (attrs.status ?? 'active') as DeviceStatus,
                        new Date(attrs.created_at),
                        attrs.last_seen_at ? new Date(attrs.last_seen_at) : null,
                        attrs.revoked_at ? new Date(attrs.revoked_at) : null,
                );
        }
}
