import { sha256 } from '@noble/hashes/sha256';
import { KeyService, KeytarKeyStore } from '@/crypto';
import type { DeviceIdentity, OneTimePrekey, SignedPrekey } from '@/crypto';
import { loadKeytar, type Keytar } from '../support/keyring.js';

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

type StoredSignedPrekey = Omit<SignedPrekey, 'privateKey'>;
type StoredOneTimePrekey = Omit<OneTimePrekey, 'privateKey'>;

export class DeviceIdentityService {
	private static readonly KEYCHAIN_SERVICE = 'ghostable-cli-device';
	private static readonly ACCOUNT_IDENTITY = 'device:identity';
	private static readonly ACCOUNT_SIGNED_PREKEY = 'device:signed-prekey';
	private static readonly ACCOUNT_ONE_TIME_PREKEYS = 'device:one-time-prekeys';

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

		const keyStore = new KeytarKeyStore(this.KEYCHAIN_SERVICE, keytar);
		KeyService.initialize(keyStore);
		return new DeviceIdentityService(keytar, keyStore);
	}

	static fingerprint(publicKeyB64: string): string {
		const decoded = Buffer.from(publicKeyB64, 'base64');
		return Buffer.from(sha256(decoded)).toString('hex');
	}

	async loadIdentity(): Promise<DeviceIdentity | null> {
		const raw = await this.keytar.getPassword(
			DeviceIdentityService.KEYCHAIN_SERVICE,
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
			DeviceIdentityService.KEYCHAIN_SERVICE,
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
			DeviceIdentityService.KEYCHAIN_SERVICE,
			DeviceIdentityService.ACCOUNT_IDENTITY,
		);
	}

	async loadSignedPrekey(): Promise<SignedPrekey | null> {
		const raw = await this.keytar.getPassword(
			DeviceIdentityService.KEYCHAIN_SERVICE,
			DeviceIdentityService.ACCOUNT_SIGNED_PREKEY,
		);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredSignedPrekey;
		const priv = await this.keyStore.getKey(`signedPrekey:${parsed.id}`);
		return {
			...parsed,
			privateKey: priv ? Buffer.from(priv).toString('base64') : undefined,
		};
	}

	async saveSignedPrekey(prekey: SignedPrekey): Promise<void> {
		const stored: StoredSignedPrekey = { ...prekey };
		delete (stored as unknown as { privateKey?: string }).privateKey;
		await this.keytar.setPassword(
			DeviceIdentityService.KEYCHAIN_SERVICE,
			DeviceIdentityService.ACCOUNT_SIGNED_PREKEY,
			JSON.stringify(stored),
		);
	}

	async clearSignedPrekey(prekeyId?: string): Promise<void> {
		if (prekeyId) {
			await this.keyStore.deleteKey(`signedPrekey:${prekeyId}`);
			return;
		}

		await this.keytar.deletePassword(
			DeviceIdentityService.KEYCHAIN_SERVICE,
			DeviceIdentityService.ACCOUNT_SIGNED_PREKEY,
		);
	}

	async loadOneTimePrekeys(): Promise<OneTimePrekey[]> {
		const raw = await this.keytar.getPassword(
			DeviceIdentityService.KEYCHAIN_SERVICE,
			DeviceIdentityService.ACCOUNT_ONE_TIME_PREKEYS,
		);
		if (!raw) return [];

		const parsed = JSON.parse(raw) as StoredOneTimePrekey[];
		const enriched: OneTimePrekey[] = [];

		for (const prekey of parsed) {
			const priv = await this.keyStore.getKey(`oneTimePrekey:${prekey.id}`);
			enriched.push({
				...prekey,
				privateKey: priv ? Buffer.from(priv).toString('base64') : undefined,
			});
		}

		return enriched;
	}

	async saveOneTimePrekeys(prekeys: OneTimePrekey[]): Promise<void> {
		const stored = prekeys
			.map((prekey) => {
				const clone: StoredOneTimePrekey = { ...prekey };
				delete (clone as unknown as { privateKey?: string }).privateKey;
				return clone;
			})
			.sort((a, b) => (a.createdAtIso ?? '').localeCompare(b.createdAtIso ?? ''));

		await this.keytar.setPassword(
			DeviceIdentityService.KEYCHAIN_SERVICE,
			DeviceIdentityService.ACCOUNT_ONE_TIME_PREKEYS,
			JSON.stringify(stored),
		);
	}

	async dropOneTimePrekeys(ids: string[]): Promise<void> {
		if (!ids.length) return;
		for (const id of ids) {
			await this.keyStore.deleteKey(`oneTimePrekey:${id}`);
		}

		const remaining = (await this.loadOneTimePrekeys()).filter(
			(prekey) => !ids.includes(prekey.id),
		);
		await this.saveOneTimePrekeys(remaining);
	}

	getKeyStore(): KeytarKeyStore {
		return this.keyStore;
	}
}
