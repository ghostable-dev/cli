import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readEnvFileWithMetadata } from '../src/environment/files/env-files.js';

const tempDirs: string[] = [];

function createEnvFile(content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostable-env-'));
	tempDirs.push(dir);
	const file = path.join(dir, '.env');
	fs.writeFileSync(file, content, 'utf8');
	return file;
}

afterEach(() => {
	while (tempDirs.length) {
		const dir = tempDirs.pop();
		if (!dir) continue;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe('readEnvFileWithMetadata', () => {
	it('captures commented variables without adding them to vars', () => {
		const filePath = createEnvFile(`# DISABLED="quoted value"\nACTIVE=1\n`);

		const meta = readEnvFileWithMetadata(filePath);

		expect(meta.vars).toEqual({ ACTIVE: '1' });
		expect(meta.snapshots.DISABLED).toMatchObject({
			value: 'quoted value',
			rawValue: '"quoted value"',
			commented: true,
		});
	});

	it('handles inline comments and whitespace', () => {
		const filePath = createEnvFile(`#FOO=bar # note\n # BAR = baz\n`);

		const meta = readEnvFileWithMetadata(filePath);

		expect(meta.vars).toEqual({});
		expect(meta.snapshots.FOO).toMatchObject({
			value: 'bar',
			rawValue: 'bar # note',
			commented: true,
		});
		expect(meta.snapshots.BAR).toMatchObject({
			value: 'baz',
			rawValue: 'baz',
			commented: true,
		});
	});
});
