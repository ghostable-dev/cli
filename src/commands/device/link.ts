import os from 'node:os';
import { Command } from 'commander';
import ora from 'ora';
import { input } from '@inquirer/prompts';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import { HttpError, type GhostableClient } from '@/ghostable';
import { KeyService } from '@/crypto';
import { ensureDeviceService, getAuthedClient } from './common.js';
import { showDeviceStatus } from './status.js';

function defaultPlatformLabel(): string {
	return `${process.platform}-${os.arch()} (${os.release()})`;
}

type LinkOptions = {
	name?: string;
	platform?: string;
	relinkStale?: boolean;
};

function isStaleIdentityError(error: unknown): boolean {
	if (error instanceof HttpError) {
		return error.status === 404 || error.status === 410 || error.status === 422;
	}

	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
	return (
		message.includes('selected device is invalid') ||
		message.includes('device not found') ||
		message.includes('not found')
	);
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

async function resolveDeviceMetadata(
	opts: LinkOptions,
): Promise<{ name: string; platform: string }> {
	const suggestedName = os.hostname();
	const suggestedPlatform = defaultPlatformLabel();

	if (opts.name || opts.platform) {
		return {
			name: opts.name?.trim() || suggestedName,
			platform: opts.platform?.trim() || suggestedPlatform,
		};
	}

	return promptForDeviceMetadata();
}

export async function linkDeviceFlow(
	client: GhostableClient,
	opts: LinkOptions = {},
): Promise<void> {
	const service = await ensureDeviceService();
	const existing = await service.loadIdentity();
	if (existing) {
		try {
			await showDeviceStatus(client, { service, identity: existing });
			log.ok('✅ Device identity already linked on this machine.');
			return;
		} catch (error) {
			if (!opts.relinkStale || !isStaleIdentityError(error)) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}

			log.warn(
				'⚠️ Existing local device identity is stale (common after app:setup). Re-linking this persona with a fresh device.',
			);
			await service.clearIdentity(existing.deviceId);
		}
	}

	const { name, platform } = await resolveDeviceMetadata(opts);
	const spinner = ora('Minting device identity…').start();
	let identity = await KeyService.createDeviceIdentity(name, platform);

	try {
		spinner.text = 'Registering device with Ghostable…';
		const registered = await client.registerDevice({
			publicKey: identity.encryptionKey.publicKey,
			publicSigningKey: identity.signingKey.publicKey,
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
		.description('Mint and register a new local device identity')
		.option('--name <NAME>', 'Device label to register')
		.option('--platform <PLATFORM>', 'Platform label to register')
		.option('--no-relink-stale', 'Disable automatic relink when local identity is stale')
		.action(async (opts: LinkOptions) => {
			const { client } = await getAuthedClient();
			try {
				await linkDeviceFlow(client, opts);
			} catch (error) {
				log.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});
}
