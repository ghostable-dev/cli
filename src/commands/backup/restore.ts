import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { select, input } from '@inquirer/prompts';

import { log } from '@/support/logger.js';
import { toErrorMessage } from '@/support/errors.js';
import { DeviceIdentityService } from '@/services/DeviceIdentityService.js';
import { backupEnvelopeFromJSON } from '@/ghostable/types/backup.js';
import { renderEnvFile, EnvFileFormat } from '@/environment/files/env-format.js';
import { writeEnvFile } from '@/environment/files/env-files.js';
import { resolveWorkDir } from '@/support/workdir.js';
import { isPromptCanceledError, promptWithCancel } from '@/support/prompts.js';
import { performBackupRestore } from './restore-core.js';
import type { BackupEnvelope } from '@/ghostable/types/backup.js';
import type { DeviceIdentity } from '@/crypto';

type BackupRestoreOptions = {
	file?: string;
	recoveryPrivateKey?: string;
	recoveryKeyFile?: string;
	toFile?: string;
	print?: boolean;
};

function ensureBackupCommand(program: Command): Command {
	const existing = program.commands.find((cmd) => cmd.name() === 'backup');
	if (existing) return existing;
	return program.command('backup').description('Manage Ghostable backups');
}

function decodeRecoveryKey(opts: BackupRestoreOptions): Uint8Array | null {
	const raw =
		opts.recoveryPrivateKey ??
		(opts.recoveryKeyFile
			? fs.readFileSync(path.resolve(resolveWorkDir(), opts.recoveryKeyFile), 'utf8')
			: undefined);
	if (!raw) return null;
	const normalized = raw.trim().replace(/^b64:/, '');
	const bytes = Buffer.from(normalized, 'base64');
	if (bytes.length !== 32) {
		throw new Error(
			'Recovery private key must be a base64-encoded X25519 secret key (32 bytes).',
		);
	}
	return new Uint8Array(bytes);
}

function renderEnvOutput(
	values: Record<string, { value: string; commented?: boolean }>,
	format: EnvFileFormat,
) {
	const entries = Object.entries(values).map(([key, entry]) => ({
		key,
		value: entry.value,
		commented: entry.commented,
	}));
	return renderEnvFile(entries, { format });
}

function listBackupCandidates(dir: string): Array<{ path: string; label: string }> {
	if (!fs.existsSync(dir)) return [];

	return fs
		.readdirSync(dir)
		.filter((name) => name.toLowerCase().endsWith('.gsb'))
		.map((name) => {
			const full = path.join(dir, name);
			const stat = fs.statSync(full);
			const mtime = stat.mtime.toISOString();
			return { path: full, label: `${name} (modified ${mtime})` };
		})
		.sort((a, b) => (a.label < b.label ? 1 : -1));
}

export function registerBackupRestoreCommand(program: Command) {
	const backup = ensureBackupCommand(program);

	backup
		.command('restore')
		.description('Restore a Ghostable backup (.gsb) locally without contacting the API')
		.option('--file <PATH>', 'Path to the .gsb backup file')
		.option('--recovery-private-key <B64>', 'Base64 X25519 private key for recovery recipient')
		.option('--recovery-key-file <PATH>', 'Read recovery private key from file')
		.option('--to-file <PATH>', 'Write decrypted secrets to this .env path')
		.option('--print', 'Print the decrypted dotenv content to stdout')
		.action(async (opts: BackupRestoreOptions) => {
			const workDir = resolveWorkDir();

			const chooseBackupPath = async (): Promise<string> => {
				if (opts.file) {
					return path.resolve(workDir, opts.file);
				}

				const backupDir = path.join(workDir, '.ghostable', 'backups');
				const candidates = listBackupCandidates(backupDir);

				if (candidates.length === 0) {
					return await promptWithCancel(() =>
						input({
							message: 'Enter the path to the backup (.gsb) file to restore',
						}),
					);
				}

				const selection = await promptWithCancel(() =>
					select<string>({
						message: 'Select a backup to restore',
						choices: [
							...candidates.map((candidate) => ({
								name: candidate.label,
								value: candidate.path,
							})),
							{ name: 'Enter a path manually', value: '__manual__' },
						],
					}),
				);

				if (selection === '__manual__') {
					return await promptWithCancel(() =>
						input({
							message: 'Enter the path to the backup (.gsb) file to restore',
						}),
					);
				}

				return selection;
			};

			const resolveOutput = async (): Promise<{ toFile?: string; print: boolean }> => {
				let toFile = opts.toFile ? path.resolve(workDir, opts.toFile) : undefined;
				let print = Boolean(opts.print);

				if (!toFile && !print) {
					const defaultOut = path.join(workDir, '.ghostable', 'restores', 'restored.env');
					const choice = await promptWithCancel(() =>
						select<'print' | 'file'>({
							message: 'Choose where to send the decrypted secrets',
							choices: [
								{ name: 'Print to stdout (for piping)', value: 'print' },
								{
									name: `Write to file (default: ${defaultOut})`,
									value: 'file',
								},
							],
						}),
					);

					if (choice === 'print') {
						print = true;
					} else {
						const entered = await promptWithCancel(() =>
							input({
								message: 'Where should the decrypted .env be written?',
								default: defaultOut,
							}),
						);
						toFile = path.resolve(workDir, entered);
					}
				}

				return { toFile, print };
			};

			let filePath: string;
			let outputTarget: { toFile?: string; print: boolean };
			try {
				filePath = await chooseBackupPath();
				outputTarget = await resolveOutput();
			} catch (error) {
				if (isPromptCanceledError(error)) {
					log.warn('Canceled.');
					process.exit(1);
					return;
				}
				throw error;
			}

			if (!filePath || !fs.existsSync(filePath)) {
				log.error('❌ Backup file not found. Use --file <PATH> to specify the .gsb file.');
				process.exit(1);
				return;
			}

			let envelope: BackupEnvelope;
			try {
				const raw = fs.readFileSync(filePath, 'utf8');
				const parsed = JSON.parse(raw);
				envelope = backupEnvelopeFromJSON(parsed);
			} catch (error) {
				log.error(`❌ Failed to read backup: ${toErrorMessage(error)}`);
				process.exit(1);
				return;
			}

			if (envelope.version !== 'backup.v1') {
				log.error(`❌ Unsupported backup version: ${envelope.version}`);
				process.exit(1);
				return;
			}

			let identity: DeviceIdentity | null = null;
			try {
				const svc = await DeviceIdentityService.create();
				identity = await svc.loadIdentity();
			} catch (error) {
				log.warn(
					`⚠️ Device identity unavailable; will rely on recovery key. (${toErrorMessage(error)})`,
				);
			}

			let recoveryPrivateKey: Uint8Array | null = null;
			try {
				recoveryPrivateKey = decodeRecoveryKey(opts);
			} catch (error) {
				log.error(`❌ Recovery key error: ${toErrorMessage(error)}`);
				process.exit(1);
				return;
			}

			if (!identity && !recoveryPrivateKey) {
				log.error(
					'❌ No usable private key available for restore. Provide a recovery key or use a device with access.',
				);
				process.exit(1);
				return;
			}

			let values: Record<string, { value: string; commented?: boolean }>;
			try {
				const result = await performBackupRestore({
					envelope,
					identity,
					recoveryPrivateKey,
				});
				values = result.values;
			} catch (error) {
				log.error(`❌ ${toErrorMessage(error)}`);
				process.exit(1);
				return;
			}

			if (outputTarget.print) {
				const rendered = renderEnvOutput(values, EnvFileFormat.ALPHABETICAL);
				process.stdout.write(rendered);
			}

			if (outputTarget.toFile) {
				const out = path.resolve(workDir, outputTarget.toFile);
				fs.mkdirSync(path.dirname(out), { recursive: true });
				writeEnvFile(
					out,
					Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.value])),
					{ format: EnvFileFormat.ALPHABETICAL },
				);
				log.ok(`✅ Wrote decrypted secrets to ${out}`);
			}
		});
}
