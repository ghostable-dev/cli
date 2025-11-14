import { sha256 } from '@noble/hashes/sha256';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';

import {
	KeyService,
	CIPHER_ALG,
	b64,
	edSign,
	randomBytes,
	type DeviceIdentity,
	type EncryptedEnvelope,
} from '@/crypto';
import { isDeploymentTokenActive } from '@/entities';
import type { DeploymentToken } from '@/entities';
import { KEYCHAIN_SERVICE_ENVIRONMENT, loadKeytar, type Keytar } from '@/keychain';
import { EnvelopeService } from '@/services/EnvelopeService.js';
import { encryptedEnvelopeFromJSON, encryptedEnvelopeToJSON } from '@/ghostable/types/crypto.js';
import type {
	CreateEnvironmentKeyEnvelopeRequest,
	CreateEnvironmentKeyEnvelopeRequestJson,
	CreateEnvironmentKeyRequest,
	CreateEnvironmentKeyRequestJson,
	EnvironmentKeyEnvelope,
	SignedClientPayload,
	SignedCreateEnvironmentKeyEnvelopeRequestJson,
	SignedCreateEnvironmentKeyRequestJson,
} from '@/ghostable/types/environment.js';
import type { GhostableClient } from '@/ghostable';
import {
	createEnvironmentKeyEnvelopeRequestToJSON,
	createEnvironmentKeyRequestToJSON,
} from '@/ghostable/types/environment.js';

function toHex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('hex');
}

function encodeKey(key: Uint8Array): string {
	return Buffer.from(key).toString('base64');
}

function decodeKey(keyB64: string): Uint8Array {
	return new Uint8Array(Buffer.from(keyB64, 'base64'));
}

type StoredEnvironmentKey = {
	keyB64: string;
	version: number;
	fingerprint: string;
};

const textEncoder = new TextEncoder();

export type EnsureEnvironmentKeyResult = {
	key: Uint8Array;
	version: number;
	fingerprint: string;
	created: boolean;
};

export class EnvironmentKeyService {
	private constructor(private readonly keytar: Keytar) {}

	static async create(): Promise<EnvironmentKeyService> {
		const keytar = await loadKeytar();
		if (!keytar) {
			throw new Error(
				'OS keychain is unavailable. Environment key management requires keychain access.',
			);
		}

		return new EnvironmentKeyService(keytar);
	}

	private static account(projectId: string, envName: string): string {
		return `${projectId}:${envName}`;
	}

	private static fingerprintOf(key: Uint8Array): string {
		return toHex(sha256(key));
	}

	private static normalizeFingerprint(value?: string | null): string {
		return value ?? '';
	}

	private static signingKeyBytes(identity: DeviceIdentity): Uint8Array {
		const privateKey = identity.signingKey?.privateKey;
		if (!privateKey) {
			throw new Error('Device identity is missing a private signing key.');
		}
		return new Uint8Array(Buffer.from(privateKey, 'base64'));
	}

	private static async signPayload<T extends Record<string, unknown>>(
		payload: T,
		identity: DeviceIdentity,
	): Promise<SignedClientPayload<T>> {
		const body = {
			device_id: identity.deviceId,
			...payload,
		};
		const bytes = textEncoder.encode(JSON.stringify(body));
		const signature = await edSign(EnvironmentKeyService.signingKeyBytes(identity), bytes);
		return {
			...body,
			client_sig: b64(signature),
		};
	}

	private static encodeRecipientEnvelope(envelope: EncryptedEnvelope): string {
		const json = encryptedEnvelopeToJSON(envelope);
		const raw = Buffer.from(JSON.stringify(json), 'utf8');
		return raw.toString('base64');
	}

	private static decodeRecipientEnvelope(payloadB64: string): EncryptedEnvelope {
		try {
			const raw = Buffer.from(payloadB64, 'base64').toString('utf8');
			const parsed = JSON.parse(raw);
			return encryptedEnvelopeFromJSON(parsed);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to decode environment key recipient payload: ${reason}`);
		}
	}

	private static encryptEnvironmentKeyCiphertext(key: Uint8Array): {
		dek: Uint8Array;
		ciphertextB64: string;
		nonceB64: string;
		alg: string;
	} {
		const dek = randomBytes(32);
		const nonce = randomBytes(24);
		const cipher = new XChaCha20Poly1305(dek);
		const ciphertext = cipher.seal(nonce, key);
		return {
			dek,
			ciphertextB64: encodeKey(ciphertext),
			nonceB64: encodeKey(nonce),
			alg: CIPHER_ALG,
		};
	}

	private static decryptEnvironmentKeyCiphertext(
		envelope: EnvironmentKeyEnvelope,
		dek: Uint8Array,
	): Uint8Array {
		const nonce = decodeKey(envelope.nonceB64);
		const ciphertext = decodeKey(envelope.ciphertextB64);
		const cipher = new XChaCha20Poly1305(dek);
		const plaintext = cipher.open(nonce, ciphertext);
		if (!plaintext) {
			throw new Error('Failed to decrypt environment key payload.');
		}
		return plaintext;
	}

	private async loadLocal(
		projectId: string,
		envName: string,
	): Promise<StoredEnvironmentKey | null> {
		const raw = await this.keytar.getPassword(
			KEYCHAIN_SERVICE_ENVIRONMENT,
			EnvironmentKeyService.account(projectId, envName),
		);
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as StoredEnvironmentKey;
			if (!parsed?.keyB64) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	private async saveLocal(
		projectId: string,
		envName: string,
		value: StoredEnvironmentKey,
	): Promise<void> {
		await this.keytar.setPassword(
			KEYCHAIN_SERVICE_ENVIRONMENT,
			EnvironmentKeyService.account(projectId, envName),
			JSON.stringify(value),
		);
	}

	async ensureEnvironmentKey(opts: {
		client: GhostableClient;
		projectId: string;
		envName: string;
		identity: DeviceIdentity;
	}): Promise<EnsureEnvironmentKeyResult> {
		const { client, projectId, envName, identity } = opts;

		const cached = await this.loadLocal(projectId, envName);
		const cachedFingerprint = cached
			? EnvironmentKeyService.normalizeFingerprint(cached.fingerprint)
			: '';

		const remote = await client.getEnvironmentKey(projectId, envName);

		if (remote) {
			const remoteFingerprint = EnvironmentKeyService.normalizeFingerprint(
				remote.fingerprint,
			);
			if (
				cached &&
				cached.version === remote.version &&
				cachedFingerprint === remoteFingerprint
			) {
				return {
					key: decodeKey(cached.keyB64),
					version: cached.version,
					fingerprint: remoteFingerprint,
					created: false,
				};
			}

			const envelope = remote.envelope;
			if (!envelope) {
				throw new Error('Environment key envelope is unavailable.');
			}

			const recipient = envelope.recipients.find(
				(item) => item.type === 'device' && item.id === identity.deviceId,
			);
			if (!recipient) {
				throw new Error(
					'Environment key is not shared with this device. Contact your administrator to request access.',
				);
			}

			const dekEnvelope = EnvironmentKeyService.decodeRecipientEnvelope(recipient.edekB64);
			const dek = await KeyService.decryptOnThisDevice(dekEnvelope, identity.deviceId);
			const plaintext = EnvironmentKeyService.decryptEnvironmentKeyCiphertext(envelope, dek);
			await this.saveLocal(projectId, envName, {
				keyB64: encodeKey(plaintext),
				version: remote.version,
				fingerprint: remoteFingerprint,
			});
			return {
				key: plaintext,
				version: remote.version,
				fingerprint: remoteFingerprint,
				created: false,
			};
		}

		const keyBytes = cached ? decodeKey(cached.keyB64) : randomBytes(32);
		const version = cached?.version ?? 1;
		const fingerprint = cachedFingerprint || EnvironmentKeyService.fingerprintOf(keyBytes);

		await this.saveLocal(projectId, envName, {
			keyB64: encodeKey(keyBytes),
			version,
			fingerprint,
		});

		return { key: keyBytes, version, fingerprint, created: true };
	}

	async publishKeyEnvelopes(opts: {
		client: GhostableClient;
		projectId: string;
		envId: string;
		envName: string;
		identity: DeviceIdentity;
		key: Uint8Array;
		version: number;
		fingerprint: string;
		created: boolean;
		extraDeployTokens?: DeploymentToken[];
	}): Promise<void> {
		const {
			client,
			projectId,
			envId,
			envName,
			identity,
			key,
			version,
			fingerprint,
			created,
			extraDeployTokens,
		} = opts;

		const devices = await client.listDevices(projectId, envName);
		const deployTokens = await client.listDeployTokens(projectId, envId);
		const deployTokensById = new Map<string, DeploymentToken>();
		for (const token of deployTokens) {
			deployTokensById.set(token.id, token);
		}
		for (const token of extraDeployTokens ?? []) {
			deployTokensById.set(token.id, token);
		}
		const allDeployTokens = Array.from(deployTokensById.values());
		if (!devices.length && !allDeployTokens.length) return;

		const encrypted = EnvironmentKeyService.encryptEnvironmentKeyCiphertext(key);
		const recipients: CreateEnvironmentKeyRequest['envelope']['recipients'] = [];
		const meta = {
			project_id: projectId,
			environment: envName,
			key_fingerprint: fingerprint,
		} as const;
		for (const device of devices) {
			if (!device.publicKey) continue;
			const envelope = await EnvelopeService.encrypt({
				sender: identity,
				recipientPublicKey: device.publicKey,
				plaintext: encrypted.dek,
				meta,
			});

			recipients.push({
				type: 'device',
				id: device.id,
				edekB64: EnvironmentKeyService.encodeRecipientEnvelope(envelope),
			});
		}

		for (const token of allDeployTokens) {
			if (!token.publicKey || !isDeploymentTokenActive(token)) continue;
			const envelope = await EnvelopeService.encrypt({
				sender: identity,
				recipientPublicKey: token.publicKey,
				plaintext: encrypted.dek,
				meta,
			});

			recipients.push({
				type: 'deployment',
				id: token.id,
				edekB64: EnvironmentKeyService.encodeRecipientEnvelope(envelope),
			});
		}

		if (!recipients.length) return;

		const envelope: CreateEnvironmentKeyRequest['envelope'] = {
			ciphertextB64: encrypted.ciphertextB64,
			nonceB64: encrypted.nonceB64,
			alg: encrypted.alg,
			recipients,
		};

		if (created) {
			const unsignedRequest: CreateEnvironmentKeyRequestJson =
				createEnvironmentKeyRequestToJSON({
					version,
					fingerprint,
					envelope,
					createdByDeviceId: identity.deviceId,
				});
			const signedRequest: SignedCreateEnvironmentKeyRequestJson =
				await EnvironmentKeyService.signPayload(unsignedRequest, identity);
			const response = await client.createEnvironmentKey(projectId, envName, signedRequest);

			await this.saveLocal(projectId, envName, {
				keyB64: encodeKey(key),
				version: response.version,
				fingerprint: EnvironmentKeyService.normalizeFingerprint(response.fingerprint),
			});
			return;
		}

		const unsignedEnvelopeRequest: CreateEnvironmentKeyEnvelopeRequestJson =
			createEnvironmentKeyEnvelopeRequestToJSON({
				fingerprint,
				envelope,
			} satisfies CreateEnvironmentKeyEnvelopeRequest);
		const signedEnvelopeRequest: SignedCreateEnvironmentKeyEnvelopeRequestJson =
			await EnvironmentKeyService.signPayload(unsignedEnvelopeRequest, identity);

		await client.createEnvironmentKeyEnvelope(projectId, envName, signedEnvelopeRequest);

		await this.saveLocal(projectId, envName, {
			keyB64: encodeKey(key),
			version,
			fingerprint: EnvironmentKeyService.normalizeFingerprint(fingerprint),
		});
	}
}
