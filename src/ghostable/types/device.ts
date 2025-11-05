export type DeviceStatusJson = 'active' | 'revoked';

export type DeviceAttributesJson = {
	public_key: string;
	platform: string;
	status?: DeviceStatusJson;
	last_seen_at?: string | null;
	revoked_at?: string | null;
	created_at: string;
};

export type DeviceResourceJson = {
	type: 'devices';
	id: string;
	attributes: DeviceAttributesJson;
};

export type DeviceDocumentJson = {
	data: DeviceResourceJson;
};

export type DeviceDeleteResponseJson = {
	data: {
		type: 'devices';
		id: string;
		attributes: {
			status: DeviceStatusJson;
			revoked_at: string | null;
		};
	};
	meta?: { success?: boolean };
};

export type QueueEnvelopeResponseJson = {
	id: string;
	queued: boolean;
};

export type DeviceEnvelopeJson = {
	id: string;
	ciphertext: string;
	created_at: string;
};

export type ConsumeEnvelopeResponseJson = {
	success: boolean;
};
