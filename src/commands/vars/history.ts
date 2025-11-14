import { Command } from 'commander';
import { select } from '@inquirer/prompts';

import { config } from '../../config/index.js';
import { SessionService } from '../../services/SessionService.js';
import { GhostableClient } from '@/ghostable';
import { Manifest } from '../../support/Manifest.js';
import { log } from '../../support/logger.js';
import { toErrorMessage } from '../../support/errors.js';
import { registerVarSubcommand } from './_shared.js';
import { resolveEnvironmentChoice } from '@/support/environment-select.js';
import { promptWithCancel } from '@/support/prompts.js';
import { formatHistoryActor } from '@/support/history.js';
import { formatDateTimeWithRelative, formatRelativeRecency } from '@/support/dates.js';
import type { VariableHistoryEntry, VariableHistorySummary } from '@/ghostable/types/history.js';

type VarHistoryOptions = {
	env?: string;
	key?: string;
};

function displayVariableHistorySummary(
	projectName: string,
	environment: string,
	variable: VariableHistorySummary,
) {
	log.info(`📘 Variable history for ${projectName}/${environment}/${variable.name}`);
	const details: string[] = [];
	if (typeof variable.latestVersion === 'number') {
		details.push(`latest version v${variable.latestVersion}`);
	}
	if (details.length) {
		log.info(details.join(' · '));
	}
	if (variable.lastUpdatedBy || variable.lastUpdatedAt) {
		const actorLabel = formatHistoryActor(variable.lastUpdatedBy);
		const when = variable.lastUpdatedAt
			? formatDateTimeWithRelative(variable.lastUpdatedAt)
			: 'Unknown time';
		log.info(`Last updated by ${actorLabel} at ${when}`);
	}
}

function renderVariableHistoryTable(entries: VariableHistoryEntry[]) {
	if (!entries.length) {
		log.warn('No history entries found for this variable.');
		return;
	}

	const rows = entries.reduce<Record<string, Record<string, string>>>((acc, entry) => {
		acc[String(entry.version)] = {
			When: formatRelativeRecency(entry.occurredAt),
			Actor: entry.actor?.email ?? 'Unknown actor',
			Operation: entry.operation,
			Version: `v${entry.version}`,
			Size: entry.line?.display ?? '',
			Commented: entry.commented ? 'yes' : '',
		};
		return acc;
	}, {});

	console.table(rows);
}

async function selectVariableName(
	client: GhostableClient,
	projectId: string,
	envName: string,
): Promise<string> {
	let response;
	try {
		response = await client.getEnvironmentKeys(projectId, envName);
	} catch (error) {
		log.error(`❌ Failed to load variables: ${toErrorMessage(error)}`);
		process.exit(1);
	}

	if (!response.data.length) {
		log.warn(`No variables found for environment "${envName}".`);
		process.exit(1);
	}

	const choices = response.data.map((item) => ({
		name: item.version ? `${item.name} (v${item.version})` : item.name,
		value: item.name,
	}));

	return promptWithCancel(() =>
		select<string>({
			message: `Select a variable from ${envName}:`,
			choices,
		}),
	);
}

export function registerVarHistoryCommand(program: Command) {
	registerVarSubcommand(
		program,
		{ subcommand: 'history', legacy: [{ name: 'var:audit' }] },
		(cmd) =>
			cmd
				.description('View the change history for a single variable')
				.option('--env <ENV>', 'Environment name (prompted if omitted)')
				.option('--key <KEY>', 'Variable name (prompted if omitted)')
				.action(async (opts: VarHistoryOptions) => {
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

					let keyName = opts.key?.trim();
					if (!keyName) {
						keyName = await selectVariableName(client, projectId, envName);
					}

					let history;
					try {
						history = await client.getVariableHistory(projectId, envName, keyName!);
					} catch (error) {
						log.error(`❌ Failed to load history entries: ${toErrorMessage(error)}`);
						process.exit(1);
						return;
					}

					displayVariableHistorySummary(projectName, envName, history.variable);
					renderVariableHistoryTable(history.entries);
					log.info(`Returned ${history.entries.length} change(s).`);
				}),
	);
}
