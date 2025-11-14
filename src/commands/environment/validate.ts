import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';
import { confirm, select } from '@inquirer/prompts';
import yaml from 'js-yaml';

import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveEnvFile, readEnvFileSafe } from '@/environment/files/env-files.js';
import {
	loadMergedSchema,
	SchemaNotFoundError,
	validateVariables,
} from '@/environment/validation/schema.js';
import type { SchemaDefinition } from '@/environment/validation/schema.js';
import { resolveWorkDir } from '@/support/workdir.js';
import { registerEnvSubcommand } from './_shared.js';

export type ValidateOptions = {
	env?: string;
	file?: string;
};

export function registerEnvValidateCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{
			subcommand: 'validate',
			legacy: [{ name: 'env:validate' }],
		},
		(cmd) =>
			cmd
				.description('Validate a local .env file against schema rules')
				.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
				.option('--file <PATH>', 'Path to .env file (default: .env.<env> or .env)')
				.action(async (opts: ValidateOptions) => runEnvValidate(opts)),
	);
}

export async function runEnvValidate(opts: ValidateOptions): Promise<void> {
	let manifestEnvs: string[];
	try {
		manifestEnvs = Manifest.environmentNames();
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
		return;
	}

	if (!manifestEnvs.length) {
		log.error('❌ No environments defined in .ghostable/ghostable.yaml.');
		process.exit(1);
		return;
	}

	let envName = opts.env;
	if (!envName) {
		envName = await select({
			message: 'Which environment would you like to validate?',
			choices: manifestEnvs.sort().map((name) => ({ name, value: name })),
		});
	}

	if (!envName) {
		log.error('❌ Unable to determine environment name.');
		process.exit(1);
		return;
	}

	const resolvedEnvName = envName;

	let filePath: string;
	try {
		filePath = resolveEnvFile(resolvedEnvName, opts.file, true);
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
		return;
	}

	const vars = readEnvFileSafe(filePath);

	let schema: SchemaDefinition;
	try {
		schema = loadMergedSchema(resolvedEnvName);
	} catch (error) {
		if (error instanceof SchemaNotFoundError) {
			log.warn(error.message);
			const shouldCreate = await confirm({
				message: 'Would you like to create one now?',
				default: true,
			});

			if (!shouldCreate) {
				process.exit(1);
				return;
			}

			try {
				const createdPath = scaffoldEnvSchema(resolvedEnvName, vars);
				log.ok(`🆕 Created ${createdPath}`);
				schema = loadMergedSchema(resolvedEnvName);
			} catch (creationError) {
				log.error(toErrorMessage(creationError));
				process.exit(1);
				return;
			}
		} else {
			log.error(toErrorMessage(error));
			process.exit(1);
			return;
		}
	}

	if (!Object.keys(schema).length) {
		log.warn('⚠️  No validation rules were found for this environment.');
		return;
	}

	const issues = validateVariables(vars, schema);

	if (issues.length) {
		log.error(`❌ Validation failed for ${resolvedEnvName} (${filePath})`);
		for (const issue of issues) {
			log.error(`   • ${issue.variable} ${issue.message}`);
		}
		process.exit(1);
		return;
	}

	log.ok('✅ Environment file passed validation.');
}

function scaffoldEnvSchema(envName: string, vars: Record<string, string>): string {
	const workDir = resolveWorkDir();
	const ghostableDir = path.join(workDir, '.ghostable');
	fs.mkdirSync(ghostableDir, { recursive: true });

	const schemaPath = path.join(ghostableDir, 'schema.yaml');
	if (fs.existsSync(schemaPath)) {
		throw new Error(`A schema file already exists at ${schemaPath}`);
	}

	const schemaObject = Object.keys(vars)
		.sort((a, b) => a.localeCompare(b))
		.reduce<Record<string, string[]>>((acc, key) => {
			acc[key] = ['required'];
			return acc;
		}, {});

	const content =
		Object.keys(schemaObject).length > 0
			? yaml.dump(schemaObject, { lineWidth: 120 })
			: `# Add validation rules for ${envName}\n`;

	fs.writeFileSync(schemaPath, content, 'utf8');
	return schemaPath;
}
