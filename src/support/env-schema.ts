import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { resolveWorkDir } from './workdir.js';

export type SchemaRule = string;
export type SchemaDefinition = Record<string, SchemaRule[]>;

export type ValidationIssue = {
	variable: string;
	message: string;
};

type ParsedRule = {
	type: string;
	argument?: string;
};

const GLOBAL_SCHEMA_FILENAMES = ['schema.yaml', 'schema.yml'];

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
		const envHint = envName
			? ` or ${path.join(root, 'schemas', `${envName}.yaml`)} (.yml also supported)`
			: '';
		throw new Error(
			`No schema definitions were found in ${path.join(root, 'schema.yaml')} (.yml also supported)${envHint}.`,
		);
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

function stripDelimiters(value: string | undefined): string | undefined {
	if (!value) return value;

	const trimmed = value.trim();

	if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
		return trimmed.slice(1, -1).trim();
	}

	return trimmed;
}

function parseNumber(argument: string | undefined): number | undefined {
	if (!argument) return undefined;

	const cleaned = Number(argument);
	return Number.isFinite(cleaned) ? cleaned : undefined;
}

function parseList(argument: string | undefined): string[] {
	const inner = stripDelimiters(argument);
	if (!inner) return [];

	return inner
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function buildRegex(argument: string | undefined): RegExp | undefined {
	if (!argument) return undefined;

	const inner = stripDelimiters(argument);
	if (!inner) return undefined;

	if (inner.startsWith('/') && inner.lastIndexOf('/') > 0) {
		const lastSlash = inner.lastIndexOf('/');
		const pattern = inner.slice(1, lastSlash);
		const flags = inner.slice(lastSlash + 1);
		try {
			return new RegExp(pattern, flags);
		} catch {
			return undefined;
		}
	}

	try {
		return new RegExp(inner);
	} catch {
		return undefined;
	}
}

function isNumeric(value: string): boolean {
	if (!value.trim()) return false;
	return !Number.isNaN(Number(value));
}

function validateRule(value: string, rule: ParsedRule): string | undefined {
	const argument = stripDelimiters(rule.argument);

	switch (rule.type) {
		case 'boolean': {
			const normalized = value.toLowerCase();
			const valid = ['true', 'false', '1', '0'];
			if (!valid.includes(normalized)) {
				return 'must be a boolean (true/false or 1/0)';
			}
			return undefined;
		}
		case 'integer': {
			if (!/^[-+]?\d+$/.test(value.trim())) {
				return 'must be an integer value';
			}
			return undefined;
		}
		case 'numeric': {
			if (!isNumeric(value)) {
				return 'must be numeric';
			}
			return undefined;
		}
		case 'string': {
			return undefined;
		}
		case 'in': {
			const candidates = parseList(argument);
			if (!candidates.length) {
				return 'has an invalid in rule';
			}
			if (!candidates.includes(value)) {
				return `must be one of: ${candidates.join(', ')}`;
			}
			return undefined;
		}
		case 'url': {
			try {
				new URL(value);
				return undefined;
			} catch {
				return 'must be a valid URL';
			}
		}
		case 'email': {
			const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!pattern.test(value)) {
				return 'must be a valid email address';
			}
			return undefined;
		}
		case 'regex': {
			const pattern = buildRegex(argument);
			if (!pattern) {
				return 'has an invalid regex rule';
			}
			if (!pattern.test(value)) {
				return `must match regex ${pattern}`;
			}
			return undefined;
		}
		case 'starts_with': {
			if (!argument) {
				return 'has an invalid starts_with rule';
			}
			if (!value.startsWith(argument)) {
				return `must start with "${argument}"`;
			}
			return undefined;
		}
		case 'ends_with': {
			if (!argument) {
				return 'has an invalid ends_with rule';
			}
			if (!value.endsWith(argument)) {
				return `must end with "${argument}"`;
			}
			return undefined;
		}
		case 'min': {
			const limit = parseNumber(argument);
			if (limit === undefined) {
				return 'has an invalid min rule';
			}

			if (isNumeric(value)) {
				if (Number(value) < limit) {
					return `must be at least ${limit}`;
				}
			} else if (value.length < limit) {
				return `must be at least ${limit} characters long`;
			}
			return undefined;
		}
		case 'max': {
			const limit = parseNumber(argument);
			if (limit === undefined) {
				return 'has an invalid max rule';
			}

			if (isNumeric(value)) {
				if (Number(value) > limit) {
					return `must be at most ${limit}`;
				}
			} else if (value.length > limit) {
				return `must be at most ${limit} characters long`;
			}
			return undefined;
		}
		case 'required':
		case 'nullable':
			return undefined;
		default:
			return `has an unknown validation rule: ${rule.type}`;
	}
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
