export type HistoryActorJson = {
	type: string;
	id?: string | null;
	name?: string | null;
	email?: string | null;
};

export type HistoryActor = {
	type: string;
	id: string | null;
	name: string | null;
	email: string | null;
};

export type HistoryLineJson = {
	bytes?: number | null;
	display?: string | null;
};

export type HistoryLine = {
	bytes: number | null;
	display: string | null;
};

export type HistoryKekJson = {
	version?: number | null;
	fingerprint?: string | null;
};

export type HistoryKek = {
	version: number | null;
	fingerprint: string | null;
};

export type HistoryEnvironmentRefJson = {
	id: string;
	name: string;
	type?: string | null;
};

export type HistoryEnvironmentRef = {
	id: string;
	name: string;
	type: string | null;
};

export type HistoryProjectRefJson = {
	id: string;
	name: string;
};

export type HistoryProjectRef = HistoryProjectRefJson;

export type HistoryEntryVariableJson = {
	name: string;
	version?: number | null;
	state?: string | null;
};

export type HistoryEntryVariable = {
	name: string;
	version: number | null;
	state: string | null;
};

export type HistoryActorBreakdownJson = Record<string, number | undefined>;
export type HistoryActorBreakdown = Record<string, number | undefined>;

export type VariableHistorySummaryJson = {
	name: string;
	latest_version?: number | null;
	last_updated_at?: string | null;
	last_updated_by?: HistoryActorJson | null;
};

export type VariableHistorySummary = {
	name: string;
	latestVersion: number | null;
	lastUpdatedAt: string | null;
	lastUpdatedBy: HistoryActor | null;
};

export type VariableHistoryEntryJson = {
	version: number;
	occurred_at: string;
	actor?: HistoryActorJson | null;
	operation: string;
	kek?: HistoryKekJson | null;
	line?: HistoryLineJson | null;
	commented?: boolean;
};

export type VariableHistoryEntry = {
	version: number;
	occurredAt: string;
	actor: HistoryActor | null;
	operation: string;
	kek: HistoryKek | null;
	line: HistoryLine | null;
	commented: boolean;
};

export type VariableHistoryResponseJson = {
	data: {
		scope: 'variable';
		environment: HistoryEnvironmentRefJson;
		variable: VariableHistorySummaryJson;
		entries: VariableHistoryEntryJson[];
	};
};

export type VariableHistoryResponse = {
	scope: 'variable';
	environment: HistoryEnvironmentRef;
	variable: VariableHistorySummary;
	entries: VariableHistoryEntry[];
};

export type EnvironmentHistorySummaryJson = {
	variables_changed_last_24h?: number | null;
	total_variables?: number | null;
	last_actor?: HistoryActorJson | null;
	last_change_at?: string | null;
};

export type EnvironmentHistorySummary = {
	variablesChangedLast24h: number | null;
	totalVariables: number | null;
	lastActor: HistoryActor | null;
	lastChangeAt: string | null;
};

export type EnvironmentHistoryEntryJson = {
	id: string;
	environment_secret_id?: string | null;
	occurred_at: string;
	actor?: HistoryActorJson | null;
	operation: string;
	variable?: HistoryEntryVariableJson | null;
	kek?: HistoryKekJson | null;
	line?: HistoryLineJson | null;
	commented?: boolean;
};

export type EnvironmentHistoryEntry = {
	id: string;
	environmentSecretId: string | null;
	occurredAt: string;
	actor: HistoryActor | null;
	operation: string;
	variable: HistoryEntryVariable | null;
	kek: HistoryKek | null;
	line: HistoryLine | null;
	commented: boolean;
};

export type EnvironmentHistoryResponseJson = {
	data: {
		scope: 'environment';
		environment: HistoryEnvironmentRefJson;
		summary?: EnvironmentHistorySummaryJson | null;
		entries: EnvironmentHistoryEntryJson[];
	};
};

export type EnvironmentHistoryResponse = {
	scope: 'environment';
	environment: HistoryEnvironmentRef;
	summary: EnvironmentHistorySummary | null;
	entries: EnvironmentHistoryEntry[];
};

export type ProjectHistorySummaryJson = {
	environment_count?: number | null;
	total_variables?: number | null;
	variables_changed_last_24h?: number | null;
	actors_last_24h?: HistoryActorBreakdownJson | null;
	last_actor?: HistoryActorJson | null;
	last_change_at?: string | null;
};

export type ProjectHistorySummary = {
	environmentCount: number | null;
	totalVariables: number | null;
	variablesChangedLast24h: number | null;
	actorsLast24h: HistoryActorBreakdown | null;
	lastActor: HistoryActor | null;
	lastChangeAt: string | null;
};

export type ProjectHistoryEntryJson = {
	id: string;
	occurred_at: string;
	actor?: HistoryActorJson | null;
	operation: string;
	scope?: {
		type: string;
		environment?: HistoryEnvironmentRefJson | null;
		[key: string]: unknown;
	} | null;
	variable?: HistoryEntryVariableJson | null;
	kek?: HistoryKekJson | null;
	line?: HistoryLineJson | null;
	commented?: boolean;
};

export type ProjectHistoryEntry = {
	id: string;
	occurredAt: string;
	actor: HistoryActor | null;
	operation: string;
	scope: {
		type: string;
		environment: HistoryEnvironmentRef | null;
	};
	variable: HistoryEntryVariable | null;
	kek: HistoryKek | null;
	line: HistoryLine | null;
	commented: boolean;
};

export type ProjectHistoryResponseJson = {
	data: {
		scope: 'project';
		project: HistoryProjectRefJson;
		summary?: ProjectHistorySummaryJson | null;
		entries: ProjectHistoryEntryJson[];
	};
};

export type ProjectHistoryResponse = {
	scope: 'project';
	project: HistoryProjectRef;
	summary: ProjectHistorySummary | null;
	entries: ProjectHistoryEntry[];
};

function historyActorFromJSON(json?: HistoryActorJson | null): HistoryActor | null {
	if (!json) return null;
	return {
		type: json.type,
		id: json.id ?? null,
		name: json.name ?? null,
		email: json.email ?? null,
	};
}

function historyLineFromJSON(json?: HistoryLineJson | null): HistoryLine | null {
	if (!json) return null;
	return {
		bytes: typeof json.bytes === 'number' ? json.bytes : null,
		display: json.display ?? null,
	};
}

function historyKekFromJSON(json?: HistoryKekJson | null): HistoryKek | null {
	if (!json) return null;
	return {
		version: typeof json.version === 'number' ? json.version : null,
		fingerprint: json.fingerprint ?? null,
	};
}

function historyEnvironmentRefFromJSON(json: HistoryEnvironmentRefJson): HistoryEnvironmentRef {
	return {
		id: json.id,
		name: json.name,
		type: json.type ?? null,
	};
}

function historyEntryVariableFromJSON(
	json?: HistoryEntryVariableJson | null,
): HistoryEntryVariable | null {
	if (!json) return null;
	return {
		name: json.name,
		version:
			typeof json.version === 'number'
				? json.version
				: json.version === undefined
					? null
					: Number.isNaN(Number(json.version))
						? null
						: Number(json.version),
		state: json.state ?? null,
	};
}

function variableSummaryFromJSON(json: VariableHistorySummaryJson): VariableHistorySummary {
	return {
		name: json.name,
		latestVersion: typeof json.latest_version === 'number' ? json.latest_version : null,
		lastUpdatedAt: json.last_updated_at ?? null,
		lastUpdatedBy: historyActorFromJSON(json.last_updated_by),
	};
}

function variableHistoryEntryFromJSON(json: VariableHistoryEntryJson): VariableHistoryEntry {
	return {
		version: json.version,
		occurredAt: json.occurred_at,
		actor: historyActorFromJSON(json.actor),
		operation: json.operation,
		kek: historyKekFromJSON(json.kek),
		line: historyLineFromJSON(json.line),
		commented: Boolean(json.commented),
	};
}

function environmentHistorySummaryFromJSON(
	json?: EnvironmentHistorySummaryJson | null,
): EnvironmentHistorySummary | null {
	if (!json) return null;
	return {
		variablesChangedLast24h:
			typeof json.variables_changed_last_24h === 'number'
				? json.variables_changed_last_24h
				: null,
		totalVariables: typeof json.total_variables === 'number' ? json.total_variables : null,
		lastActor: historyActorFromJSON(json.last_actor),
		lastChangeAt: json.last_change_at ?? null,
	};
}

function environmentHistoryEntryFromJSON(
	json: EnvironmentHistoryEntryJson,
): EnvironmentHistoryEntry {
	return {
		id: json.id,
		environmentSecretId: json.environment_secret_id ?? null,
		occurredAt: json.occurred_at,
		actor: historyActorFromJSON(json.actor),
		operation: json.operation,
		variable: historyEntryVariableFromJSON(json.variable),
		kek: historyKekFromJSON(json.kek),
		line: historyLineFromJSON(json.line),
		commented: Boolean(json.commented),
	};
}

function projectHistorySummaryFromJSON(
	json?: ProjectHistorySummaryJson | null,
): ProjectHistorySummary | null {
	if (!json) return null;
	return {
		environmentCount:
			typeof json.environment_count === 'number' ? json.environment_count : null,
		totalVariables: typeof json.total_variables === 'number' ? json.total_variables : null,
		variablesChangedLast24h:
			typeof json.variables_changed_last_24h === 'number'
				? json.variables_changed_last_24h
				: null,
		actorsLast24h: json.actors_last_24h ?? null,
		lastActor: historyActorFromJSON(json.last_actor),
		lastChangeAt: json.last_change_at ?? null,
	};
}

function projectHistoryEntryFromJSON(json: ProjectHistoryEntryJson): ProjectHistoryEntry {
	return {
		id: json.id,
		occurredAt: json.occurred_at,
		actor: historyActorFromJSON(json.actor),
		operation: json.operation,
		scope: {
			type: json.scope?.type ?? 'project',
			environment: json.scope?.environment
				? historyEnvironmentRefFromJSON(json.scope.environment)
				: null,
		},
		variable: historyEntryVariableFromJSON(json.variable),
		kek: historyKekFromJSON(json.kek),
		line: historyLineFromJSON(json.line),
		commented: Boolean(json.commented),
	};
}

export function variableHistoryFromJSON(
	json: VariableHistoryResponseJson,
): VariableHistoryResponse {
	return {
		scope: json.data.scope,
		environment: historyEnvironmentRefFromJSON(json.data.environment),
		variable: variableSummaryFromJSON(json.data.variable),
		entries: json.data.entries.map(variableHistoryEntryFromJSON),
	};
}

export function environmentHistoryFromJSON(
	json: EnvironmentHistoryResponseJson,
): EnvironmentHistoryResponse {
	return {
		scope: json.data.scope,
		environment: historyEnvironmentRefFromJSON(json.data.environment),
		summary: environmentHistorySummaryFromJSON(json.data.summary),
		entries: json.data.entries.map(environmentHistoryEntryFromJSON),
	};
}

export function projectHistoryFromJSON(json: ProjectHistoryResponseJson): ProjectHistoryResponse {
	return {
		scope: json.data.scope,
		project: json.data.project,
		summary: projectHistorySummaryFromJSON(json.data.summary),
		entries: json.data.entries.map(projectHistoryEntryFromJSON),
	};
}
