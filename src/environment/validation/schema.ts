import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { getRuleValidator } from './rules/index.js';
import type { ParsedRule } from './rules/types.js';
import { resolveWorkDir } from '@/support/workdir.js';

export type SchemaRule = string;
export type SchemaDefinition = Record<string, SchemaRule[]>;

export type ValidationIssue = {
	variable: string;
	message: string;
};

const GLOBAL_SCHEMA_FILENAMES = ['schema.yaml', 'schema.yml'];

export class SchemaNotFoundError extends Error {
	readonly checkedLocations: string[];

	constructor(checkedLocations: string[]) {
		super(formatMissingSchemaMessage(checkedLocations));
		this.checkedLocations = checkedLocations;
		this.name = 'SchemaNotFoundError';
	}
}

function formatMissingSchemaMessage(locations: string[]): string {
	if (!locations.length) {
		return 'No schema definitions found.';
	}

	if (locations.length === 1) {
		return `No schema definitions found. Checked ${locations[0]}.`;
	}

	const [first, ...rest] = locations;
	return `No schema definitions found. Checked ${first} or ${rest.join(' or ')}.`;
}
function schemaRoot(): string {
	return path.resolve(resolveWorkDir(), '.ghostable');
}

function loadYamlFile(filePath: string): unknown {
	const raw = fs.readFileSync(filePath, 'utf8');
	return yaml.load(raw) ?? {};
}

function normalizeRuleEntry(entry: unknown): SchemaRule[] {
	if (Array.isArray(entry)) {
		return entry
			.map((value) => (typeof value === 'string' ? value.trim() : ''))
			.filter((value): value is string => Boolean(value.length));
	}

	if (typeof entry === 'string') {
		const value = entry.trim();
		return value ? [value] : [];
	}

	return [];
}

function parseSchemaObject(source: unknown): SchemaDefinition {
	if (!source || typeof source !== 'object') {
		return {};
	}

	const out: SchemaDefinition = {};

	for (const [key, value] of Object.entries(source)) {
		if (typeof key !== 'string' || !key.trim()) continue;

		out[key.trim()] = normalizeRuleEntry(value);
	}

	return out;
}

function resolveExistingFile(paths: string[]): string | undefined {
	for (const filePath of paths) {
		if (fs.existsSync(filePath)) {
			return filePath;
		}
	}
	return undefined;
}

function loadSchemaFile(filePath: string | undefined): SchemaDefinition {
	if (!filePath) {
		return {};
	}

	try {
		return parseSchemaObject(loadYamlFile(filePath));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse schema file at ${filePath}: ${message}`);
	}
}

export function resolveSchemaPaths(envName?: string): {
	global?: string;
	environment?: string;
} {
	const root = schemaRoot();

	const global = resolveExistingFile(
		GLOBAL_SCHEMA_FILENAMES.map((filename) => path.join(root, filename)),
	);

	if (!envName) {
		return { global };
	}

	const envDir = path.join(root, 'schemas');
	const candidates = [`${envName}.yaml`, `${envName}.yml`].map((filename) =>
		path.join(envDir, filename),
	);

	return {
		global,
		environment: resolveExistingFile(candidates),
	};
}

export function loadMergedSchema(envName?: string): SchemaDefinition {
	const { global, environment } = resolveSchemaPaths(envName);

	if (!global && !environment) {
		const root = schemaRoot();
		const locations = [path.join(root, 'schema.(yaml|yml)')];
		if (envName) {
			locations.push(path.join(root, 'schemas', `${envName}.(yaml|yml)`));
		}
		throw new SchemaNotFoundError(locations);
	}

	const base = loadSchemaFile(global);
	const overrides = loadSchemaFile(environment);

	return { ...base, ...overrides };
}

function parseRule(rule: SchemaRule): ParsedRule {
	const trimmed = rule.trim();
	const colonIndex = trimmed.indexOf(':');

	if (colonIndex === -1) {
		return { type: trimmed };
	}

	return {
		type: trimmed.slice(0, colonIndex).trim(),
		argument: trimmed.slice(colonIndex + 1).trim(),
	};
}

function validateRule(value: string, rule: ParsedRule): string | undefined {
	const validator = getRuleValidator(rule.type);
	if (!validator) {
		return `has an unknown validation rule: ${rule.type}`;
	}

	return validator(value, rule);
}

export function validateVariables(
	vars: Record<string, string>,
	schema: SchemaDefinition,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const [variable, rules] of Object.entries(schema)) {
		const rawValue = vars[variable];
		const parsedRules = rules.map(parseRule);
		const required = parsedRules.some((rule) => rule.type === 'required');
		const nullable = parsedRules.some((rule) => rule.type === 'nullable');

		if (rawValue === undefined) {
			if (required) {
				issues.push({
					variable,
					message: 'is required but was not found',
				});
			}
			continue;
		}

		if (!rawValue.length) {
			if (required && !nullable) {
				issues.push({
					variable,
					message: 'cannot be blank',
				});
				continue;
			}

			if (nullable) {
				continue;
			}
		}

		for (const rule of parsedRules) {
			const error = validateRule(rawValue, rule);
			if (error) {
				issues.push({
					variable,
					message: error,
				});
			}
		}
	}

	return issues;
}
