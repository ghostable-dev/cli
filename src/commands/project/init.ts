import { Command } from 'commander';
import { select, input } from '@inquirer/prompts';
import ora from 'ora';

import { Manifest } from '../../support/Manifest.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { config } from '../../config/index.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import {
	DeploymentProvider,
	ProjectStackTag,
	stackFrameworkChoices,
	stackLanguageChoices,
	stackPlatformChoices,
} from '@/entities';
import type { Project, ProjectStackChoice, ProjectStackShape } from '@/entities';

function toPromptChoices(options: ProjectStackChoice[]) {
	return options.map((option) => ({
		name: option.label,
		value: option.value,
		description: option.description,
	}));
}

function inferDeploymentProviderFromPlatform(platform?: ProjectStackTag): DeploymentProvider {
	switch (platform) {
		case ProjectStackTag.PlatformLaravelCloud:
			return DeploymentProvider.LaravelCloud;
		case ProjectStackTag.PlatformLaravelForge:
			return DeploymentProvider.LaravelForge;
		case ProjectStackTag.PlatformLaravelVapor:
			return DeploymentProvider.LaravelVapor;
		default:
			return DeploymentProvider.Other;
	}
}

export function registerInitCommand(program: Command) {
	program
		.command('init')
		.description('Link this directory to a Ghostable project')
		.action(async () => {
			const apiBase = config.apiBase;

			// Ensure we have a session & org
			const sessions = new SessionService();
			const sess = await sessions.load();
			if (!sess?.accessToken) {
				log.error('❌ Not authenticated. Run `ghostable login` first.');
				process.exit(1);
			}
			if (!sess.organizationId) {
				log.error(
					'❌ No organization selected. Run `ghostable login` and pick an organization (or add an org switch command).',
				);
				process.exit(1);
			}

			const client = GhostableClient.unauthenticated(apiBase).withToken(sess.accessToken);

			// Fetch projects (domain)
			const spinner = ora('Loading projects…').start();
			let projects: Project[] = [];
			try {
				projects = await client.projects(sess.organizationId);
				spinner.succeed(
					`Loaded ${projects.length} project${projects.length === 1 ? '' : 's'}.`,
				);
			} catch (error) {
				spinner.fail('Failed loading projects.');
				log.error(toErrorMessage(error));
				process.exit(1);
			}

			// Build project choices
			const choices = [
				{ name: '[Create a new project]', value: '__new__' },
				...projects.map((p) => ({
					name: p.name || p.id,
					value: p.id,
				})),
			];

			const selection = await select<string>({
				message: 'Which project should this directory be linked to?',
				choices,
				pageSize: Math.min(10, choices.length || 1),
				default: '__new__',
			});

			let project: Project;
			let deploymentProvider: DeploymentProvider | undefined;
			let projectStack: ProjectStackShape | undefined;

			if (selection !== '__new__') {
				const found = projects.find((p) => p.id === selection);
				if (!found) {
					log.error('❌ Selected project not found.');
					process.exit(1);
				}
				project = found;
				deploymentProvider = project.deploymentProvider;
			} else {
				const name = await input({
					message: 'What is the name of this project?',
					validate: (v) => (v && v.trim().length > 0) || 'Project name is required',
				});

				const description = await input({
					message: 'Add a short description for this project (optional):',
					default: '',
				});

				const languageChoices = stackLanguageChoices();
				const language = await select<ProjectStackTag>({
					message: 'Which language powers this project?',
					choices: toPromptChoices(languageChoices),
					pageSize: languageChoices.length,
					default: languageChoices[0]?.value,
				});

				const frameworkChoices = stackFrameworkChoices(language);
				const framework = await select<ProjectStackTag>({
					message: 'Which framework do you use?',
					choices: toPromptChoices(frameworkChoices),
					pageSize: frameworkChoices.length,
					default: frameworkChoices[0]?.value,
				});

				const platformChoices = stackPlatformChoices(framework);
				const platform = await select<ProjectStackTag>({
					message: 'Where will you deploy this project?',
					choices: toPromptChoices(platformChoices),
					pageSize: platformChoices.length,
					default: platformChoices[0]?.value,
				});

				projectStack = {
					language,
					framework,
					platform,
				};

				const providerForApi = inferDeploymentProviderFromPlatform(platform);
				deploymentProvider = providerForApi;

				const createSpin = ora('Creating project…').start();
				try {
					project = await client.createProject({
						organizationId: sess.organizationId,
						name: name.trim(),
						description: description.trim() || undefined,
						deploymentProvider: providerForApi,
						stack: projectStack,
					});
					createSpin.succeed(`Project created: ${project.name}`);
				} catch (error) {
					createSpin.fail('Failed creating project.');
					log.error(toErrorMessage(error));
					process.exit(1);
				}
			}

			// Write manifest
			try {
				const manifestEnvs =
					project.environments?.map((env: { name: string; type: string }) => ({
						name: env.name,
						type: env.type ?? undefined,
					})) ?? [];

				Manifest.fresh({
					id: project.id,
					name: project.name,
					deploymentProvider: deploymentProvider ?? project.deploymentProvider,
					stack: projectStack,
					environments: manifestEnvs,
				});

				log.ok(`✅ ${project.name} initialized. ${Manifest.resolve()} created.`);
			} catch (error) {
				log.error(`❌ Failed writing manifest: ${toErrorMessage(error)}`);
				process.exit(1);
			}
		});
}
