import { sha256 } from '@noble/hashes/sha256';
import { KeyService, KeytarKeyStore } from '@/crypto';
import type { DeviceIdentity } from '@/crypto';
import {
	KEYCHAIN_SERVICE_DEVICE_IDENTITY,
	keychainServiceForDeviceEncryptionKey,
	keychainServiceForDeviceSigningKey,
	loadKeytar,
	type Keytar,
} from '@/keychain';

type StoredIdentity = Omit<DeviceIdentity, 'signingKey' | 'encryptionKey'> & {
	signingKey: {
		alg: 'Ed25519';
		publicKey: string;
	};
	encryptionKey: {
		alg: 'X25519';
		publicKey: string;
		derivedFromSigningKey?: boolean;
	};
};

export class DeviceIdentityService {
	private static readonly ACCOUNT_IDENTITY = 'device:identity';
	private static readonly ACCOUNT_PRIVATE_SIGNING_KEY = 'signing-key';
	private static readonly ACCOUNT_PRIVATE_ENCRYPTION_KEY = 'encryption-key';

	private constructor(
		private readonly keytar: Keytar,
		private readonly keyStore: KeytarKeyStore,
	) {}

	static async create(): Promise<DeviceIdentityService> {
		const keytar = await loadKeytar();
		if (!keytar) {
			throw new Error(
				'OS keychain is unavailable. Device commands require access to the keychain.',
			);
		}

		const keyStore = new KeytarKeyStore(DeviceIdentityService.resolveDeviceKeyTarget, keytar);
		KeyService.initialize(keyStore);
		return new DeviceIdentityService(keytar, keyStore);
	}

	private static resolveDeviceKeyTarget(name: string): { service: string; account: string } {
		const parts = name.split(':');
		if (parts.length !== 3 || parts[0] !== 'device') {
			throw new Error(`Unsupported device key identifier: ${name}`);
		}

		const [, deviceId, keyName] = parts;
		if (!deviceId) {
			throw new Error('Device id is required for device key storage.');
		}

		if (keyName === 'signingKey') {
			return {
				service: keychainServiceForDeviceSigningKey(deviceId),
				account: DeviceIdentityService.ACCOUNT_PRIVATE_SIGNING_KEY,
			};
		}

		if (keyName === 'encryptionKey') {
			return {
				service: keychainServiceForDeviceEncryptionKey(deviceId),
				account: DeviceIdentityService.ACCOUNT_PRIVATE_ENCRYPTION_KEY,
			};
		}

		throw new Error(`Unsupported device key type: ${keyName}`);
	}

	static fingerprint(publicKeyB64: string): string {
		const decoded = Buffer.from(publicKeyB64, 'base64');
		return Buffer.from(sha256(decoded)).toString('hex');
	}

	async loadIdentity(): Promise<DeviceIdentity | null> {
		const raw = await this.keytar.getPassword(
			KEYCHAIN_SERVICE_DEVICE_IDENTITY,
			DeviceIdentityService.ACCOUNT_IDENTITY,
		);
		if (!raw) return null;

		const parsed = JSON.parse(raw) as StoredIdentity;
		const signing = await this.keyStore.getKey(`device:${parsed.deviceId}:signingKey`);
		const encryption = await this.keyStore.getKey(`device:${parsed.deviceId}:encryptionKey`);
		if (!signing || !encryption) {
			throw new Error('Device identity is corrupted. Private keys are missing.');
		}

		return {
			...parsed,
			signingKey: {
				...parsed.signingKey,
				privateKey: Buffer.from(signing).toString('base64'),
			},
			encryptionKey: {
				...parsed.encryptionKey,
				privateKey: Buffer.from(encryption).toString('base64'),
			},
		};
	}

	async requireIdentity(): Promise<DeviceIdentity> {
		const identity = await this.loadIdentity();
		if (!identity) {
			throw new Error('No device identity is linked on this machine.');
		}
		return identity;
	}

	async saveIdentity(identity: DeviceIdentity): Promise<void> {
		const stored: StoredIdentity = {
			...identity,
			signingKey: {
				alg: identity.signingKey.alg,
				publicKey: identity.signingKey.publicKey,
			},
			encryptionKey: {
				alg: identity.encryptionKey.alg,
				publicKey: identity.encryptionKey.publicKey,
				derivedFromSigningKey: identity.encryptionKey.derivedFromSigningKey,
			},
		};

		await this.keytar.setPassword(
			KEYCHAIN_SERVICE_DEVICE_IDENTITY,
			DeviceIdentityService.ACCOUNT_IDENTITY,
			JSON.stringify(stored),
		);
	}

	async renameDeviceKeys(oldId: string, nextId: string): Promise<void> {
		if (!oldId || !nextId || oldId === nextId) return;

		const signing = await this.keyStore.getKey(`device:${oldId}:signingKey`);
		if (signing) {
			await this.keyStore.setKey(`device:${nextId}:signingKey`, signing);
			await this.keyStore.deleteKey(`device:${oldId}:signingKey`);
		}

		const encryption = await this.keyStore.getKey(`device:${oldId}:encryptionKey`);
		if (encryption) {
			await this.keyStore.setKey(`device:${nextId}:encryptionKey`, encryption);
			await this.keyStore.deleteKey(`device:${oldId}:encryptionKey`);
		}
	}

	async clearIdentity(deviceId?: string): Promise<void> {
		const currentId = deviceId ?? (await this.loadIdentity())?.deviceId ?? undefined;

		if (currentId) {
			await this.keyStore.deleteKey(`device:${currentId}:signingKey`);
			await this.keyStore.deleteKey(`device:${currentId}:encryptionKey`);
		}

		await this.keytar.deletePassword(
			KEYCHAIN_SERVICE_DEVICE_IDENTITY,
			DeviceIdentityService.ACCOUNT_IDENTITY,
		);
	}
}
