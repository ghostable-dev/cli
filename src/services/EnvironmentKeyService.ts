import { sha256 } from '@noble/hashes/sha256';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';

import { randomBytes } from '../crypto.js';
import { loadKeytar, type Keytar } from '../support/keyring.js';
import { EnvelopeService } from './EnvelopeService.js';
import type { GhostableClient } from './GhostableClient.js';

import { KeyService, type DeviceIdentity, type EncryptedEnvelope } from '@/crypto';
import { isDeploymentTokenActive } from '../domain/DeploymentToken.js';
import { encryptedEnvelopeFromJSON, encryptedEnvelopeToJSON } from '../types/api/crypto.js';
import type {
	CreateEnvironmentKeyEnvelopeRequest,
	CreateEnvironmentKeyRequest,
	EnvironmentKeyEnvelope,
} from '../types/api/environment.js';
import { CIPHER_ALG } from '../types/crypto.js';

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

export type EnsureEnvironmentKeyResult = {
	key: Uint8Array;
	version: number;
	fingerprint: string;
	created: boolean;
};

export class EnvironmentKeyService {
	private static readonly KEYCHAIN_SERVICE = 'ghostable-cli-env';

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
			EnvironmentKeyService.KEYCHAIN_SERVICE,
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
			EnvironmentKeyService.KEYCHAIN_SERVICE,
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
		envName: string;
		identity: DeviceIdentity;
		key: Uint8Array;
		version: number;
		fingerprint: string;
		created: boolean;
	}): Promise<void> {
		const { client, projectId, envName, identity, key, version, fingerprint, created } = opts;

		const devices = await client.listDevices(projectId, envName);
		const deployTokens = await client.listDeployTokens(projectId, envName);
		if (!devices.length && !deployTokens.length) return;

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

		for (const token of deployTokens) {
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
			const response = await client.createEnvironmentKey(projectId, envName, {
				version,
				fingerprint,
				envelope,
				createdByDeviceId: identity.deviceId,
			});

			await this.saveLocal(projectId, envName, {
				keyB64: encodeKey(key),
				version: response.version,
				fingerprint: EnvironmentKeyService.normalizeFingerprint(response.fingerprint),
			});
			return;
		}

		await client.createEnvironmentKeyEnvelope(projectId, envName, {
			fingerprint,
			envelope,
		} satisfies CreateEnvironmentKeyEnvelopeRequest);

		await this.saveLocal(projectId, envName, {
			keyB64: encodeKey(key),
			version,
			fingerprint: EnvironmentKeyService.normalizeFingerprint(fingerprint),
		});
	}
}
