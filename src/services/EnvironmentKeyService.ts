import { sha256 } from '@noble/hashes/sha256';

import { randomBytes } from '../crypto.js';
import { loadKeytar, type Keytar } from '../support/keyring.js';
import { EnvelopeService } from './EnvelopeService.js';
import type { GhostableClient } from './GhostableClient.js';

import { KeyService, type DeviceIdentity } from '@/crypto';
import { isDeploymentTokenActive } from '@/domain';
import type { CreateEnvironmentKeyRequest } from '@/types';

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

			const envelope = remote.envelopes.find(
				(item) => item.recipientType === 'device' && item.recipientId === identity.deviceId,
			);
			if (!envelope) {
				throw new Error(
					'Environment key is not shared with this device. Contact your administrator to request access.',
				);
			}

			const plaintext = await KeyService.decryptOnThisDevice(
				envelope.envelope,
				identity.deviceId,
			);
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
	}): Promise<void> {
		const { client, projectId, envName, identity, key, version, fingerprint } = opts;

		const devices = await client.listDevices(projectId, envName);
		const deployTokens = await client.listDeployTokens(projectId, envName);
		if (!devices.length && !deployTokens.length) return;

		const envelopes: CreateEnvironmentKeyRequest['envelopes'] = [];
		for (const device of devices) {
			if (!device.publicKey) continue;
			const envelope = await EnvelopeService.encrypt({
				sender: identity,
				recipientPublicKey: device.publicKey,
				plaintext: key,
				meta: {
					project_id: projectId,
					environment: envName,
					key_fingerprint: fingerprint,
				},
			});

			envelopes.push({
				kind: 'device',
				id: device.id,
				envelope,
			});
		}

		for (const token of deployTokens) {
			if (!token.publicKey || !isDeploymentTokenActive(token)) continue;
			const envelope = await EnvelopeService.encrypt({
				sender: identity,
				recipientPublicKey: token.publicKey,
				plaintext: key,
				meta: {
					project_id: projectId,
					environment: envName,
					key_fingerprint: fingerprint,
				},
			});

			envelopes.push({
				kind: 'deployment',
				id: token.id,
				envelope,
			});
		}

		if (!envelopes.length) return;

		const response = await client.createEnvironmentKey(projectId, envName, {
			version,
			fingerprint,
			envelopes,
			createdByDeviceId: identity.deviceId,
		});

		await this.saveLocal(projectId, envName, {
			keyB64: encodeKey(key),
			version: response.version,
			fingerprint: EnvironmentKeyService.normalizeFingerprint(response.fingerprint),
		});
	}
}
