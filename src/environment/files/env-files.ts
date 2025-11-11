import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveWorkDir } from '@/support/workdir.js';
import { EnvFileFormat, renderEnvFile } from './env-format.js';

export type EnvVarSnapshot = {
	value: string;
	rawValue: string;
	commented?: boolean;
};

export type EnvFileMetadata = {
	vars: Record<string, string>;
	snapshots: Record<string, EnvVarSnapshot>;
};

/**
 * Write a .env-style file from a vars map.
 */
export type WriteEnvFileOptions = {
	preserve?: Record<string, EnvVarSnapshot>;
	format?: EnvFileFormat;
};

export function writeEnvFile(
	filePath: string,
	vars: Record<string, string>,
	opts?: WriteEnvFileOptions,
): void {
	const preserve = opts?.preserve ?? {};
	const entries = Object.keys(vars).map((key) => {
		const snapshot = preserve[key];
		const value = vars[key];
		const commented =
			snapshot && snapshot.value === value ? Boolean(snapshot.commented) : undefined;

		return {
			key,
			value,
			commented,
			snapshot,
		};
	});

	const content = renderEnvFile(entries, { format: opts?.format });

	fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Read a .env-style file into a vars map.
 */
export function readEnvFile(filePath: string): Record<string, string> {
	return readEnvFileWithMetadata(filePath).vars;
}

export function readEnvFileSafe(filePath: string): Record<string, string> {
	try {
		return readEnvFile(filePath);
	} catch {
		return {};
	}
}

export function readEnvFileWithMetadata(filePath: string): EnvFileMetadata {
	if (!fs.existsSync(filePath)) {
		return { vars: {}, snapshots: {} };
	}

	let raw = fs.readFileSync(filePath, 'utf8');
	if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

	const vars = dotenv.parse(raw);
	const snapshots: Record<string, EnvVarSnapshot> = {};

	const lines = raw.split(/\r?\n/);
	for (const line of lines) {
		const match = line.match(/^\s*(#\s*)?([\w.-]+)\s*=\s*(.*)$/);
		if (!match) continue;

		const [, hashPrefix, key, rawValue] = match;
		const commented = Boolean(hashPrefix);

		let value: string | undefined;
		if (commented) {
			const synthetic = dotenv.parse(`${key}=${rawValue}`);
			value = synthetic[key];
		} else {
			value = vars[key];
		}

		if (value === undefined) continue;

		snapshots[key] = {
			value,
			rawValue,
			commented,
		};
	}

	return { vars, snapshots };
}

export function readEnvFileSafeWithMetadata(filePath: string): EnvFileMetadata {
	try {
		return readEnvFileWithMetadata(filePath);
	} catch {
		return { vars: {}, snapshots: {} };
	}
}

export function buildPreservedSnapshot(
	metadata: EnvFileMetadata,
	overrides: Record<string, string>,
): Record<string, EnvVarSnapshot> {
	const preserved: Record<string, EnvVarSnapshot> = {};

	for (const [key, snapshot] of Object.entries(metadata.snapshots)) {
		const overrideValue = overrides[key];
		if (overrideValue === undefined || overrideValue === snapshot.value) {
			preserved[key] = snapshot;
		}
	}

	return preserved;
}

/**
 * Resolve which .env file to use.
 * Resolution order:
 *   1) explicit path (if provided)
 *   2) .env.<envName> in work dir (if envName provided)
 *   3) .env in work dir
 *
 * @param envName Optional environment name, e.g., "production"
 * @param explicitPath Optional path passed via flag
 * @param mustExist Throw if a resolved file does not exist
 */
export function resolveEnvFile(envName?: string, explicitPath?: string, mustExist = false): string {
	const workDir = resolveWorkDir();

	// 1) explicit path wins (relative to workDir)
	if (explicitPath) {
		const p = path.resolve(workDir, explicitPath);
		if (fs.existsSync(p)) return p;
		if (mustExist) {
			throw new Error(`.env file not found at explicit path: ${p}`);
		}
		// fall through to candidates if not required to exist
	}

	// 2) .env.<envName>
	if (envName) {
		const byEnv = path.resolve(workDir, `.env.${envName}`);
		if (fs.existsSync(byEnv)) return byEnv;
	}

	// 3) default .env
	const fallback = path.resolve(workDir, '.env');
	if (fs.existsSync(fallback)) return fallback;

	if (mustExist) {
		const tried = [
			explicitPath && path.resolve(workDir, explicitPath),
			envName && path.resolve(workDir, `.env.${envName}`),
			fallback,
		]
			.filter(Boolean)
			.join(', ');
		throw new Error(`.env file not found. Tried: ${tried}`);
	}

	// If nothing exists and not required, return the default location so callers can create it.
	return fallback;
}
