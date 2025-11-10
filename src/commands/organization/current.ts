import { Command } from 'commander';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { log } from '../../support/logger.js';

export function configureOrganizationCurrentCommand(org: Command) {
	org.command('current')
		.aliases(['org:current', 'orgs:current', 'organizations:current', 'organization:current'])
		.description('Show the organization currently set for this CLI')
		.action(async () => {
			// 1. Load session / access token
			const sessionSvc = new SessionService();
			const sess = await sessionSvc.load();
			if (!sess?.accessToken) {
				log.error('❌ Not authenticated. Run `ghostable login`.');
				process.exit(1);
			}

			const currentOrgId = sess.organizationId;
			if (!currentOrgId) {
				log.error('❌ No organization selected. Run `ghostable org switch` to select one.');
				process.exit(1);
			}

			// 2. Fetch organizations
			const client = GhostableClient.unauthenticated(config.apiBase).withToken(
				sess.accessToken,
			);
			const orgs = await client.organizations();
			const orgRecord = orgs.find((o) => o.id === currentOrgId);

			// 3. Display result
			if (!orgRecord) {
				log.error('❌ Unable to determine current organization (not found in API list).');
				process.exit(1);
			}

			log.ok(`✅ Current organization: ${orgRecord.name ?? currentOrgId}`);
		});
}
