import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';

import { Manifest } from '@/support/Manifest.js';
import { SessionService } from '@/services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { config } from '@/config/index.js';
import { DeviceIdentityService } from '@/services/DeviceIdentityService.js';
import { log } from '@/support/logger.js';
import { toErrorMessage } from '@/support/errors.js';
import { resolveWorkDir } from '@/support/workdir.js';
import { promptWithCancel } from '@/support/prompts.js';
import { signClientPayload } from '@/support/signing.js';

import type { SignedCreateBackupRequestJson } from '@/ghostable/types/backup.js';

type BackupCreateOptions = {
	env?: string;
	recoveryKey?: string;
	recoveryKeyFile?: string;
	recoveryLabel?: string;
	output?: string;
	yes?: boolean;
};

function ensureBackupCommand(program: Command): Command {
	const existing = program.commands.find((cmd) => cmd.name() === 'backup');
	if (existing) return existing;
	return program.command('backup').description('Manage Ghostable backups');
}

function sanitize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function defaultOutputPath(projectName: string, envName: string): string {
	const workDir = resolveWorkDir();
	const dir = path.join(workDir, '.ghostable', 'backups');
	const timestamp = new Date().toISOString().replace(/[:]/g, '-');
	const filename = `ghostable-${sanitize(projectName)}-${sanitize(envName)}-${timestamp}.gsb`;
	return path.join(dir, filename);
}

function loadRecoveryKey(opts: BackupCreateOptions): string | undefined {
	if (opts.recoveryKey) return opts.recoveryKey.trim();
	if (opts.recoveryKeyFile) {
		const raw = fs.readFileSync(path.resolve(resolveWorkDir(), opts.recoveryKeyFile), 'utf8');
		return raw.trim();
	}
	return undefined;
}

export function registerBackupCreateCommand(program: Command) {
	const backup = ensureBackupCommand(program);

	backup
		.command('create')
		.description('Create a zero-knowledge encrypted backup for an environment')
		.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
		.option('--recovery-key <B64>', 'Optional organization recovery X25519 public key (base64)')
		.option(
			'--recovery-key-file <PATH>',
			'Read recovery public key from file (overrides --recovery-key)',
		)
		.option('--recovery-label <LABEL>', 'Label to store alongside the recovery recipient')
		.option('--output <PATH>', 'Output path for the .gsb file (default: ./backups/...)')
		.option('--yes', 'Skip confirmation prompts')
		.action(async (opts: BackupCreateOptions) => {
			let projectId: string;
			let projectName: string;
			let envNames: string[];

			try {
				projectId = Manifest.id();
				projectName = Manifest.name();
				envNames = Manifest.environmentNames();
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			if (!envNames.length) {
				log.error('❌ No environments defined in .ghostable/ghostable.yaml.');
				process.exit(1);
			}

			let envName = opts.env?.trim();
			if (!envName) {
				envName = await promptWithCancel(() =>
					select<string>({
						message: 'Which environment should be backed up?',
						choices: envNames
							.slice()
							.sort()
							.map((value) => ({ name: value, value })),
					}),
				);
			}

			const recoveryPublicKey = loadRecoveryKey(opts);
			const outPath = path.resolve(
				resolveWorkDir(),
				opts.output ?? defaultOutputPath(projectName, envName),
			);

			if (!opts.yes) {
				const accepted = await confirm({
					message:
						'Backups are non-revocable. Access is fixed at creation time and you are responsible for key custody. Continue?',
					default: false,
				});
				if (!accepted) {
					log.info('Backup cancelled.');
					return;
				}
			}

			let token: string;
			try {
				token =
					process.env.GHOSTABLE_TOKEN ||
					(await new SessionService().load())?.accessToken ||
					'';
				if (!token)
					throw new Error('No API token. Run `ghostable login` or set GHOSTABLE_TOKEN.');
			} catch (error) {
				log.error(toErrorMessage(error));
				process.exit(1);
				return;
			}

			let identityService: DeviceIdentityService;
			let identity;
			try {
				identityService = await DeviceIdentityService.create();
				identity = await identityService.requireIdentity();
			} catch (error) {
				log.error(`❌ Failed to load device identity: ${toErrorMessage(error)}`);
				process.exit(1);
				return;
			}

			const unsigned: Partial<SignedCreateBackupRequestJson> = {};
			if (recoveryPublicKey) unsigned.recovery_public_key = recoveryPublicKey;
			if (opts.recoveryLabel) unsigned.recovery_label = opts.recoveryLabel;

			let signed: SignedCreateBackupRequestJson;
			try {
				signed = await signClientPayload(unsigned, identity);
			} catch (error) {
				log.error(`❌ Failed to sign request: ${toErrorMessage(error)}`);
				process.exit(1);
				return;
			}

			const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);
			const spin = ora('Requesting backup from Ghostable…').start();

			try {
				const envelope = await client.createEnvironmentBackup(projectId, envName, signed);
				spin.succeed('Backup envelope created.');

				fs.mkdirSync(path.dirname(outPath), { recursive: true });
				fs.writeFileSync(outPath, JSON.stringify(envelope, null, 2), 'utf8');

				log.ok(`✅ Backup saved to ${outPath}`);
				log.info(
					`Recipients: ${envelope.recipients.map((r) => `${r.type}:${r.id}`).join(', ')}`,
				);
				log.info('Store this file offline. Only the included keys can decrypt it.');
			} catch (error) {
				spin.fail('Failed to create backup.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}
