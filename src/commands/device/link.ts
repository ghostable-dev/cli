import os from 'node:os';
import { Command } from 'commander';
import ora from 'ora';
import { input } from '@inquirer/prompts';
import { log } from '../../support/logger.js';
import { DeviceIdentityService } from '../../services/DeviceIdentityService.js';
import type { GhostableClient } from '../../services/GhostableClient.js';
import { KeyService, type OneTimePrekey, type SignedPrekey } from '@/crypto';
import {
        DEFAULT_PREKEY_BATCH,
        ensureDeviceService,
        getAuthedClient,
        persistOneTimePrekeys,
} from './common.js';

function defaultPlatformLabel(): string {
        return `${process.platform}-${os.arch()} (${os.release()})`;
}

async function promptForDeviceMetadata() {
        const suggestedName = os.hostname();
        const name = await input({
                message: 'Device label',
                default: suggestedName,
        });

        const platform = await input({
                message: 'Platform (reported to Ghostable)',
                default: defaultPlatformLabel(),
        });

        return { name: name.trim() || suggestedName, platform: platform.trim() || defaultPlatformLabel() };
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
        let signedPrekey: SignedPrekey | null = null;
        let oneTimes: OneTimePrekey[] = [];

        try {
                spinner.text = 'Registering device with Ghostable…';
                const registered = await client.registerDevice({
                        publicKey: identity.encryptionKey.publicKey,
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

                spinner.text = 'Creating signed prekey…';
                signedPrekey = await KeyService.createSignedPrekey(identity);
                const publish = await client.publishSignedPrekey(identity.deviceId, signedPrekey);
                signedPrekey = { ...signedPrekey, fingerprint: publish.fingerprint };
                await service.saveSignedPrekey(signedPrekey);

                spinner.text = `Uploading ${DEFAULT_PREKEY_BATCH} one-time prekeys…`;
                oneTimes = await KeyService.createOneTimePrekeys(DEFAULT_PREKEY_BATCH);
                await client.publishOneTimePrekeys(identity.deviceId, oneTimes);
                const bundle = await client.getDevicePrekeys(identity.deviceId);
                await persistOneTimePrekeys(service, bundle);

                spinner.succeed('Device linked successfully.');
                log.ok(`✅ Device ID: ${identity.deviceId}`);
                log.ok(
                        `🔑 Encryption fingerprint: ${DeviceIdentityService.fingerprint(identity.encryptionKey.publicKey)}`,
                );
        } catch (error) {
                spinner.fail('Device linking failed.');
                await service.clearIdentity(identity.deviceId);
                if (signedPrekey) {
                        await service.clearSignedPrekey(signedPrekey.id);
                }
                await service.clearSignedPrekey();
                if (oneTimes.length) {
                        await service.dropOneTimePrekeys(oneTimes.map((prekey) => prekey.id));
                }
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
