import os from 'node:os';
import { Command } from 'commander';
import ora from 'ora';
import { input } from '@inquirer/prompts';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import type { GhostableClient } from '../../services/GhostableClient.js';
import { KeyService } from '@/crypto';
import { ensureDeviceService, getAuthedClient } from './common.js';

function defaultPlatformLabel(): string {
	return `${process.platform}-${os.arch()} (${os.release()})`;
}

async function promptForDeviceMetadata() {
	const suggestedName = os.hostname();
	const name = await input({
		message: 'Device label (reported to Ghostable)',
		default: suggestedName,
	});

	const platform = await input({
		message: 'Platform (reported to Ghostable)',
		default: defaultPlatformLabel(),
	});

	return {
		name: name.trim() || suggestedName,
		platform: platform.trim() || defaultPlatformLabel(),
	};
}

export async function linkDeviceFlow(client: GhostableClient): Promise<void> {
	const service = await ensureDeviceService();
	const existing = await service.loadIdentity();
	if (existing) {
		log.ok('✅ Device identity already linked on this machine.');
		return;
	}

	const { name, platform } = await promptForDeviceMetadata();
	const spinner = ora('Minting device identity…').start();
	let identity = await KeyService.createDeviceIdentity(name, platform);

	try {
		spinner.text = 'Registering device with Ghostable…';
		const registered = await client.registerDevice({
			publicKey: identity.encryptionKey.publicKey,
			name,
			platform,
		});

		if (registered.id !== identity.deviceId) {
			await service.renameDeviceKeys(identity.deviceId, registered.id);
			identity = {
				...identity,
				deviceId: registered.id,
			};
		}

		spinner.text = 'Persisting device identity locally…';
		await service.saveIdentity(identity);

		spinner.succeed('Device linked successfully.');
		log.ok(`✅ Device ID: ${identity.deviceId}`);
		log.ok(
			`🔑 Encryption fingerprint: ${DeviceIdentityService.fingerprint(identity.encryptionKey.publicKey)}`,
		);
	} catch (error) {
		spinner.fail('Device linking failed.');
		await service.clearIdentity(identity.deviceId);
		throw error;
	}
}

export function configureLinkCommand(device: Command) {
	device
		.command('link')
		.alias('init')
		.description('Provision a new device identity and register it with Ghostable.')
		.action(async () => {
			const { client } = await getAuthedClient();
			try {
				await linkDeviceFlow(client);
			} catch (error) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
