import { edSign, b64, type DeviceIdentity } from '@/crypto';

const textEncoder = new TextEncoder();

function signingKeyBytes(identity: DeviceIdentity): Uint8Array {
	const privateKey = identity.signingKey?.privateKey;
	if (!privateKey) {
		throw new Error('Device identity is missing a private signing key.');
	}
	return new Uint8Array(Buffer.from(privateKey, 'base64'));
}

/**
 * Signs an arbitrary payload with the device's signing key and stamps the device id.
 */
export async function signClientPayload<T extends Record<string, unknown>>(
	payload: T,
	identity: DeviceIdentity,
): Promise<T & { device_id: string; client_sig: string }> {
	const body = {
		device_id: identity.deviceId,
		...payload,
	};

	const bytes = textEncoder.encode(JSON.stringify(body));
	const signature = await edSign(signingKeyBytes(identity), bytes);

	return {
		...body,
		client_sig: b64(signature),
	};
}
