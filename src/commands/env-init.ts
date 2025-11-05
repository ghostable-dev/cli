import { Command } from 'commander';
import { select, input } from '@inquirer/prompts';
import ora from 'ora';
import chalk from 'chalk';

import { Manifest } from '../support/Manifest.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { config } from '../config/index.js';
import { log } from '../support/logger.js';
import { toErrorMessage } from '../support/errors.js';

import type { EnvironmentType, EnvironmentSuggestedName } from '@/entities';

export function registerEnvInitCommand(program: Command) {
	program
		.command('env:init')
		.description(
			'Initialize a new environment in the current organization and project context.',
		)
		.option('--name <NAME>', 'Environment name (slug)')
		.action(async (opts: { name?: string }) => {
			// 1) Ensure session and project context
			const sessionSvc = new SessionService();
			const sess = await sessionSvc.load();
			if (!sess?.accessToken) {
				log.error('❌ Not authenticated. Run `ghostable login`.');
				process.exit(1);
			}

			let projectId: string;
			try {
				projectId = Manifest.id();
			} catch {
				log.error('❌ No project selected. Run `ghostable init` first.');
				process.exit(1);
				return;
			}

			const client = GhostableClient.unauthenticated(config.apiBase).withToken(
				sess.accessToken,
			);

			// 2) Fetch environment types (DOMAIN: EnvironmentType[])
			const typesSpinner = ora('Loading environment types…').start();
			let typeOptions: EnvironmentType[] = [];
			try {
				typeOptions = await client.getEnvironmentTypes();
				typesSpinner.succeed(`Loaded ${typeOptions.length} environment types.`);
			} catch (error) {
				typesSpinner.fail('Failed to load environment types.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}

			const selectedType = await select<string>({
				message: 'What type of environment are you creating?',
				choices: typeOptions.map((t) => ({
					name: t.label(),
					value: t.value,
				})),
				pageSize: Math.min(12, typeOptions.length || 1),
			});

			// 3) Name (option > suggestions > custom)
			let name: string | undefined = opts.name;
			if (!name) {
				const suggestSpinner = ora('Fetching suggested environment names…').start();
				let suggestions: EnvironmentSuggestedName[] = [];
				try {
					suggestions = await client.suggestEnvironmentNames(projectId, selectedType);
					suggestSpinner.succeed();
				} catch {
					suggestSpinner.stop();
				}

				if (suggestions.length) {
					const suggestionChoices = [
						...suggestions.map((s) => ({
							name: s.name,
							value: s.name,
						})),
						{
							name: 'Custom name',
							value: '__CUSTOM__',
						},
					];

					const choice = await select<string>({
						message:
							'Choose an environment name or enter a custom one (must be unique and slug formatted)',
						choices: suggestionChoices,
						pageSize: Math.min(12, suggestionChoices.length || 1),
					});

					name =
						choice === '__CUSTOM__'
							? await input({
									message: 'Enter a unique slug-formatted environment name:',
									validate: (v) =>
										/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v) ||
										'Use slug format (lowercase, digits, -, _).',
								})
							: choice;
				} else {
					name = await input({
						message: 'Enter a unique slug-formatted environment name:',
						validate: (v) =>
							/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v) ||
							'Use slug format (lowercase, digits, -, _).',
					});
				}
			}

			// 4) Create the environment (DOMAIN: Environment)
			const createSpinner = ora(`Creating environment "${name}"…`).start();
			try {
				const env = await client.createEnvironment({
					projectId,
					name: name!,
					type: selectedType,
					baseId: null,
				});
				createSpinner.succeed(`Environment "${env.name}" created.`);

				// 5) Update manifest locally
				Manifest.addEnvironment({
					name: env.name,
					type: env.type,
				});

				log.ok(`✅ Environment ${chalk.bold(env.name)} added to .ghostable/ghostable.yaml`);
			} catch (error) {
				createSpinner.fail('Failed creating environment.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}
		});
}
