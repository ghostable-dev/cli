import { Command } from 'commander';
import { config } from '../config/index.js';
import { SessionService } from '../services/SessionService.js';
import { GhostableClient } from '../services/GhostableClient.js';
import { log } from '../support/logger.js';
import type { Organization } from '@/domain';

export function registerOrganizationListCommand(program: Command) {
	program
		.command('org:list')
		.aliases(['orgs:list', 'organizations:list', 'organization:list'])
		.description('List the organizations that you belong to.')
		.action(async () => {
			const sess = await loadSessionOrExit();
			const currentOrgId = sess.organizationId;

			const orgs = await fetchOrganizations(sess.accessToken);
			if (orgs.length === 0) {
				log.warn('No organizations found for this account.');
				return;
			}

			renderTable(orgs, currentOrgId);
		});

	async function loadSessionOrExit(): Promise<{ accessToken: string; organizationId?: string }> {
		const sessionSvc = new SessionService();
		const sess = await sessionSvc.load();
		if (!sess?.accessToken) {
			log.error('❌ Not authenticated. Run `ghostable login`.');
			process.exit(1);
		}
		return sess;
	}

	async function fetchOrganizations(accessToken: string): Promise<Organization[]> {
		const client = GhostableClient.unauthenticated(config.apiBase).withToken(accessToken);

		const orgs = await client.organizations();
		return orgs.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
	}

	function renderTable(orgs: Organization[], currentOrgId?: string): void {
		const rows = orgs.map((o) => ({
			ID: o.id,
			Name: o.name ?? '',
			Current: o.id === currentOrgId ? '✅' : '',
		}));

		const keyed = Object.fromEntries(
			rows.map((r) => [r.ID, { Name: r.Name, Current: r.Current }]),
		);

		console.table(keyed);
	}
}
