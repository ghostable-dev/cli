import { Command } from 'commander';
import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { registerEnvSubcommand } from './_shared.js';
import { formatHistoryActor } from '@/support/history.js';
import { formatDateTimeWithRelative, formatRelativeRecency } from '@/support/dates.js';
import type {
	EnvironmentHistoryEntry,
	EnvironmentHistorySummary,
} from '@/ghostable/types/history.js';
import { resolveEnvironmentChoice } from '@/support/environment-select.js';

type EnvHistoryOptions = {
	env?: string;
};

function displaySummary(
	projectName: string,
	environment: string,
	summary: EnvironmentHistorySummary | null,
) {
	log.info(`📘 Environment history for ${projectName}/${environment}`);
	if (!summary) {
		log.info('No summary data is available for this environment yet.');
		return;
	}

	const stats: string[] = [];
	if (typeof summary.variablesChangedLast24h === 'number') {
		stats.push(`${summary.variablesChangedLast24h} changes (24h)`);
	}
	if (typeof summary.totalVariables === 'number') {
		stats.push(`${summary.totalVariables} variables total`);
	}

	if (stats.length) {
		log.info(stats.join(' · '));
	}

	if (summary.lastActor || summary.lastChangeAt) {
		const actorLabel = formatHistoryActor(summary.lastActor);
		const when = summary.lastChangeAt
			? formatDateTimeWithRelative(summary.lastChangeAt)
			: 'Unknown time';
		log.info(`Last change by ${actorLabel} at ${when}`);
	}
}

function renderEnvironmentHistoryTable(entries: EnvironmentHistoryEntry[]) {
	if (!entries.length) {
		log.warn('No history entries found for this environment.');
		return;
	}

	const rows = entries.reduce<Record<string, Record<string, string>>>((acc, entry, index) => {
		const variableName = entry.variable?.name ?? '—';
		const versionLabel =
			entry.variable?.version !== null && entry.variable?.version !== undefined
				? `v${entry.variable.version}`
				: '';
		const actorEmail = entry.actor?.email ?? 'Unknown actor';

		acc[String(index + 1)] = {
			When: formatRelativeRecency(entry.occurredAt),
			Actor: actorEmail,
			Operation: entry.operation,
			Key: variableName,
			Version: versionLabel,
			Commented: entry.commented ? 'yes' : '',
		};
		return acc;
	}, {});

	console.table(rows);
}

export function registerEnvHistoryCommand(program: Command) {
	registerEnvSubcommand(
		program,
		{ subcommand: 'history', legacy: [{ name: 'env:audit' }] },
		(cmd) =>
			cmd
				.description('View the change history for an environment')
				.option('--env <ENV>', 'Environment name (prompted if omitted)')
				.action(async (opts: EnvHistoryOptions) => {
					let projectId: string;
					let projectName: string;
					let envNames: string[];

					try {
						projectId = Manifest.id();
						projectName = Manifest.name();
						envNames = Manifest.environmentNames();
					} catch (error) {
						log.error(toErrorMessage(error));
						process.exit(1);
						return;
					}

					const envName = await resolveEnvironmentChoice(
						envNames,
						opts.env,
						'Select an environment to inspect:',
					);

					const session = await new SessionService().load();
					if (!session?.accessToken) {
						log.error('❌ Not authenticated. Run `ghostable login`.');
						process.exit(1);
						return;
					}

					const client = GhostableClient.unauthenticated(config.apiBase).withToken(
						session.accessToken,
					);

					let history;
					try {
						history = await client.getEnvironmentHistory(projectId, envName);
					} catch (error) {
						log.error(`❌ Failed to load history entries: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					displaySummary(projectName, envName, history.summary);
					renderEnvironmentHistoryTable(history.entries);
					log.info(`Returned ${history.entries.length} change(s).`);
				}),
	);
}
