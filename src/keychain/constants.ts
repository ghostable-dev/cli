const KEYCHAIN_NAMESPACE = process.env.GHOSTABLE_KEYCHAIN_PREFIX?.trim() || 'dev.ghostable';

function scopedKeychainService(path: string): string {
	return `${KEYCHAIN_NAMESPACE}.cli.${path}`;
}

export const KEYCHAIN_SERVICE_SESSION = scopedKeychainService('session-token');

export const KEYCHAIN_SERVICE_DEVICE_IDENTITY = scopedKeychainService('device.identity');

export const KEYCHAIN_SERVICE_ENVIRONMENT = scopedKeychainService('environment-key');

export function keychainServiceForDeviceEncryptionKey(deviceId: string): string {
	if (!deviceId) {
		throw new Error('deviceId is required to derive the encryption key service name.');
	}
	return scopedKeychainService(`device.${deviceId}.encryption-key`);
}

export function keychainServiceForDeviceSigningKey(deviceId: string): string {
	if (!deviceId) {
		throw new Error('deviceId is required to derive the signing key service name.');
	}
	return scopedKeychainService(`device.${deviceId}.signing-key`);
}
