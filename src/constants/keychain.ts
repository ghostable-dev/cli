export const KEYCHAIN_SERVICE_SESSION = 'dev.ghostable.cli.session-token';

export const KEYCHAIN_SERVICE_DEVICE_IDENTITY = 'dev.ghostable.cli.device.identity';

export const KEYCHAIN_SERVICE_ENVIRONMENT = 'dev.ghostable.cli.environment-key';

export const KEYCHAIN_SERVICE_KEY_BUNDLE = 'dev.ghostable.cli.key-bundle';

export function keychainServiceForDeviceEncryptionKey(deviceId: string): string {
	if (!deviceId) {
		throw new Error('deviceId is required to derive the encryption key service name.');
	}
	return `dev.ghostable.cli.device.${deviceId}.encryption-key`;
}

export function keychainServiceForDeviceSigningKey(deviceId: string): string {
	if (!deviceId) {
		throw new Error('deviceId is required to derive the signing key service name.');
	}
	return `dev.ghostable.cli.device.${deviceId}.signing-key`;
}
