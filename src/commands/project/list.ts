import { Command } from 'commander';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { log } from '../../support/logger.js';
import type { Project } from '@/entities';

function ensureProjectCommand(program: Command): Command {
	const existing = program.commands.find((cmd) => cmd.name() === 'project');
	if (existing) return existing;

	return program
		.command('project')
		.aliases(['projects'])
		.description('Manage Ghostable projects');
}

export function registerProjectListCommand(program: Command) {
	const project = ensureProjectCommand(program);

	project
		.command('list')
		.aliases(['ls'])
		.description('List projects within the active organization context')
		.action(async () => {
			const session = await loadSessionOrExit();
			const orgId = session.organizationId;

			if (!orgId) {
				log.error('❌ No organization selected. Run `ghostable org:switch`.');
				process.exit(1);
			}

			const projects = await fetchProjects(session.accessToken, orgId);

			if (!projects.length) {
				log.warn('No projects found in this organization.');
				return;
			}

			renderTable(projects);
		});
}

async function loadSessionOrExit(): Promise<{ accessToken: string; organizationId?: string }> {
	const sessionSvc = new SessionService();
	const session = await sessionSvc.load();

	if (!session?.accessToken) {
		log.error('❌ Not authenticated. Run `ghostable login`.');
		process.exit(1);
	}

	return session;
}

async function fetchProjects(accessToken: string, organizationId: string): Promise<Project[]> {
	const client = GhostableClient.unauthenticated(config.apiBase).withToken(accessToken);

	const projects = await client.projects(organizationId);
	return projects.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

function renderTable(projects: Project[]): void {
	const rows = projects.map((project) => {
		const environments = (project.environments ?? [])
			.map((env) => env.name as string)
			.filter((name): name is string => Boolean(name))
			.join(', ');

		return {
			ID: project.id,
			Name: project.name ?? '',
			Environments: environments,
		};
	});

	const keyed = Object.fromEntries(
		rows.map((row) => [row.Name || row.ID, { ID: row.ID, Environments: row.Environments }]),
	);

	console.table(keyed);
}
