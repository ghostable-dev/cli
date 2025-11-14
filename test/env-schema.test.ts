import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let workDir = '';

vi.mock('../src/support/workdir.js', () => ({
	resolveWorkDir: () => workDir,
}));

const { loadMergedSchema, validateVariables, SchemaNotFoundError } = await import(
	'../src/environment/validation/schema.js'
);

const tmpDirs: string[] = [];

beforeEach(() => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostable-schema-'));
	workDir = dir;
	tmpDirs.push(dir);
});

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	workDir = '';
});

describe('loadMergedSchema', () => {
	it('merges global schema with environment overrides', () => {
		const ghostableDir = path.join(workDir, '.ghostable');
		fs.mkdirSync(path.join(ghostableDir, 'schemas'), { recursive: true });

		fs.writeFileSync(
			path.join(ghostableDir, 'schema.yaml'),
			['APP_NAME:', '  - required', '  - string', 'LOG_LEVEL:', '  - in:<debug,info>'].join(
				'\n',
			),
			'utf8',
		);

		fs.writeFileSync(
			path.join(ghostableDir, 'schemas', 'local.yaml'),
			['LOG_LEVEL:', '  - in:<debug,info,trace>', 'DEBUG:', '  - boolean'].join('\n'),
			'utf8',
		);

		const merged = loadMergedSchema('local');

		expect(merged).toEqual({
			APP_NAME: ['required', 'string'],
			LOG_LEVEL: ['in:<debug,info,trace>'],
			DEBUG: ['boolean'],
		});
	});

	it('throws when no schema files exist', () => {
		expect(() => loadMergedSchema('local')).toThrowError(SchemaNotFoundError);
		expect(() => loadMergedSchema('local')).toThrowError(/No schema definitions found/);
	});
});

describe('validateVariables', () => {
	it('collects validation issues for failing rules', () => {
		const schema = {
			REQUIRED_VAR: ['required'],
			FEATURE_FLAG: ['boolean'],
			CONTACT_EMAIL: ['required', 'email'],
			LIMIT: ['numeric', 'min:10', 'max:20'],
			MODE: ['in:<read,write>'],
		} as const;

		const issues = validateVariables(
			{
				FEATURE_FLAG: 'maybe',
				CONTACT_EMAIL: 'invalid-email',
				LIMIT: '5',
				MODE: 'admin',
			},
			schema,
		);

		expect(issues).toEqual([
			{
				variable: 'REQUIRED_VAR',
				message: 'is required but was not found',
			},
			{
				variable: 'FEATURE_FLAG',
				message: 'must be a boolean (true/false or 1/0)',
			},
			{
				variable: 'CONTACT_EMAIL',
				message: 'must be a valid email address',
			},
			{
				variable: 'LIMIT',
				message: 'must be at least 10',
			},
			{
				variable: 'MODE',
				message: 'must be one of: read, write',
			},
		]);
	});

	it('skips nullable values for further validation', () => {
		const schema = {
			OPTIONAL: ['required', 'nullable', 'integer'],
		} as const;

		const issues = validateVariables({ OPTIONAL: '' }, schema);

		expect(issues).toEqual([]);
	});
});
