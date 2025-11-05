import { Command } from 'commander';
import { select } from '@inquirer/prompts';

import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { resolveEnvFile, readEnvFileSafe } from '@/environment/files/env-files.js';
import { loadMergedSchema, validateVariables } from '@/environment/validation/schema.js';
import type { SchemaDefinition } from '@/environment/validation/schema.js';

export type ValidateOptions = {
	env?: string;
	file?: string;
};

export function registerEnvValidateCommand(program: Command) {
	program
		.command('env:validate')
		.description('Validate a local environment file using schema rules')
		.option('--env <ENV>', 'Environment name (if omitted, select from manifest)')
		.option('--file <PATH>', 'Path to .env file (default: .env.<env> or .env)')
		.action(async (opts: ValidateOptions) => runEnvValidate(opts));
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

	let filePath: string;
	try {
		filePath = resolveEnvFile(envName, opts.file, true);
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
		return;
	}

	const vars = readEnvFileSafe(filePath);

	let schema: SchemaDefinition;
	try {
		schema = loadMergedSchema(envName);
	} catch (error) {
		log.error(toErrorMessage(error));
		process.exit(1);
		return;
	}

	if (!Object.keys(schema).length) {
		log.warn('⚠️  No validation rules were found for this environment.');
		return;
	}

	const issues = validateVariables(vars, schema);

	if (issues.length) {
		log.error(`❌ Validation failed for ${envName} (${filePath})`);
		for (const issue of issues) {
			log.error(`   • ${issue.variable} ${issue.message}`);
		}
		process.exit(1);
		return;
	}

	log.ok('✅ Environment file passed validation.');
}
