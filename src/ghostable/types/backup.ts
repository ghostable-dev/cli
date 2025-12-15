import type { EnvironmentSecretBundleJson } from './environment.js';

export type BackupRecipientJson = {
	type: 'device' | 'recovery';
	id: string;
	label?: string | null;
	public_key?: string | null;
	edek_b64: string;
};

export type CreateBackupRequestJson = {
	device_id: string;
	client_sig: string;
	recovery_public_key?: string | null;
	recovery_label?: string | null;
};

export type SignedCreateBackupRequestJson = CreateBackupRequestJson;

export type BackupPayloadJson = {
	version: string;
	meta: {
		backup_id: string;
		project_id: string;
		environment_id: string;
		environment: string;
		created_at: string;
	};
	bundle: EnvironmentSecretBundleJson;
};

export type BackupEnvelopeJson = {
	version: string;
	backup_id: string;
	created_at: string;
	project: {
		id: string;
		name: string;
	};
	environment: {
		id: string;
		name: string;
	};
	payload: {
		alg: string;
		nonce_b64?: string;
		nonceB64?: string;
		ciphertext_b64?: string;
		ciphertextB64?: string;
		aad_b64?: string;
		aadB64?: string;
	};
	recipients: BackupRecipientJson[];
	integrity?: {
		sha256_b64?: string | null;
		payload_bytes?: number | null;
	} | null;
	statistics?: {
		secret_count?: number | null;
		recipient_count?: number | null;
	} | null;
	environment_key_fingerprint?: string | null;
	request?: {
		ip_address?: string | null;
		device_id?: string | null;
		device_name?: string | null;
	} | null;
};

export type BackupRecipient = {
	type: 'device' | 'recovery';
	id: string;
	label?: string | null;
	publicKey?: string | null;
	edekB64: string;
};

export type BackupEnvelope = {
	version: string;
	backupId: string;
	createdAt: string;
	project: {
		id: string;
		name: string;
	};
	environment: {
		id: string;
		name: string;
	};
	payload: {
		alg: string;
		nonceB64?: string | null;
		ciphertextB64?: string | null;
		aadB64?: string | null;
	};
	recipients: BackupRecipient[];
	integrity?: {
		sha256B64?: string | null;
		payloadBytes?: number | null;
	};
	statistics?: {
		secretCount?: number | null;
		recipientCount?: number | null;
	};
	environmentKeyFingerprint?: string | null;
	request?: {
		ipAddress?: string | null;
		deviceId?: string | null;
		deviceName?: string | null;
	};
};

export type BackupPayload = {
	version: string;
	meta: BackupPayloadJson['meta'];
	bundle: EnvironmentSecretBundleJson;
};

export function backupEnvelopeFromJSON(json: BackupEnvelopeJson): BackupEnvelope {
	const resolvePayloadField = (jsonPayload: BackupEnvelopeJson['payload'], key: string) => {
		return (
			(jsonPayload as Record<string, string | undefined>)[`${key}_b64`] ??
			(jsonPayload as Record<string, string | undefined>)[`${key}B64`] ??
			null
		);
	};

	const normalizeEdek = (recipient: BackupRecipientJson): string => {
		const edek =
			(recipient as unknown as { edek_b64?: string }).edek_b64 ??
			(recipient as unknown as { edek?: string }).edek ??
			(recipient as unknown as { edekB64?: string }).edekB64;

		if (!edek || typeof edek !== 'string') {
			throw new Error('Backup recipient is missing encrypted key material.');
		}

		return edek;
	};

	return {
		version: json.version,
		backupId: json.backup_id,
		createdAt: json.created_at,
		project: {
			id: json.project.id,
			name: json.project.name,
		},
		environment: {
			id: json.environment.id,
			name: json.environment.name,
		},
		payload: {
			alg: json.payload.alg,
			nonceB64: resolvePayloadField(json.payload, 'nonce') ?? undefined,
			ciphertextB64: resolvePayloadField(json.payload, 'ciphertext') ?? undefined,
			aadB64: resolvePayloadField(json.payload, 'aad') ?? undefined,
		},
		recipients: (json.recipients ?? []).map((recipient) => ({
			type: recipient.type,
			id: recipient.id,
			label: recipient.label ?? null,
			publicKey: recipient.public_key ?? null,
			edekB64: normalizeEdek(recipient),
		})),
		integrity: json.integrity
			? {
					sha256B64: json.integrity.sha256_b64 ?? null,
					payloadBytes: json.integrity.payload_bytes ?? null,
				}
			: undefined,
		statistics: json.statistics
			? {
					secretCount: json.statistics.secret_count ?? null,
					recipientCount: json.statistics.recipient_count ?? null,
				}
			: undefined,
		environmentKeyFingerprint: json.environment_key_fingerprint ?? null,
		request: json.request
			? {
					ipAddress: json.request.ip_address ?? null,
					deviceId: json.request.device_id ?? null,
					deviceName: json.request.device_name ?? null,
				}
			: undefined,
	};
}
