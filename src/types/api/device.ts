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

export type PublishSignedPrekeyResponseJson = {
	fingerprint: string;
	updated_at: string;
};

export type PublishOneTimePrekeysResponseJson = {
	queued: number;
};

export type DeviceSignedPrekeyJson = {
	id: string;
	public_key: string;
	signature: string;
	fingerprint: string;
	expires_at?: string | null;
	created_at: string;
};

export type DeviceOneTimePrekeyJson = {
	id: string;
	public_key: string;
	fingerprint: string;
	expires_at?: string | null;
	created_at: string;
};

export type DevicePrekeyBundleJson = {
	signed_prekey: DeviceSignedPrekeyJson | null;
	one_time_prekeys: DeviceOneTimePrekeyJson[];
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
