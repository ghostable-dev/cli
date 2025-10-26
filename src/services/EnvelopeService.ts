import { KeyService, type DeviceIdentity, type EncryptedEnvelope } from '@/crypto';

export type EncryptEnvelopeInput = {
	sender: DeviceIdentity;
	recipientPublicKey: string;
	plaintext: Uint8Array;
	meta?: Record<string, string>;
};

export class EnvelopeService {
	static async encrypt(input: EncryptEnvelopeInput): Promise<EncryptedEnvelope> {
		const { sender, recipientPublicKey, plaintext, meta } = input;
		return KeyService.encryptForDevice(sender, recipientPublicKey, plaintext, meta);
	}
}
