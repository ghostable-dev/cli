import type { SignedClientPayload } from './environment.js';
import type { HistoryActor, HistoryActorJson } from './history.js';

export type RollbackVariableRequest = {
	versionId: string;
	ifVersion?: number;
};

export type RollbackVariableRequestJson = {
	version_id: string;
	if_version?: number;
};

export function rollbackVariableRequestToJSON(
	request: RollbackVariableRequest,
): RollbackVariableRequestJson {
	return {
		version_id: request.versionId,
		...(request.ifVersion !== undefined ? { if_version: request.ifVersion } : {}),
	};
}

export type SignedRollbackVariableRequestJson = SignedClientPayload<RollbackVariableRequestJson>;

export type RollbackResultVariableJson = {
	name: string;
	version?: number | null;
	rolled_back_to_version?: number | null;
};

export type RollbackResultVariable = {
	name: string;
	version: number | null;
	rolledBackToVersion: number | null;
};

type RollbackResultActorJson =
	| HistoryActorJson
	| { actor?: HistoryActorJson | null; label?: string | null }
	| string
	| null;

export type RollbackResultActor = {
	label: string | null;
	actor: HistoryActor | null;
};

export type RollbackResultDataJson = {
	variable: RollbackResultVariableJson;
	previous_head_version?: number | null;
	snapshot_id?: string | null;
	updated_at?: string | null;
	updated_by?: RollbackResultActorJson;
};

export type RollbackResultData = {
	variable: RollbackResultVariable;
	previousHeadVersion: number | null;
	snapshotId: string | null;
	updatedAtIso: string | null;
	updatedBy: RollbackResultActor | null;
};

export type RollbackResultResponseJson = {
	status: string;
	data: RollbackResultDataJson;
};

export type RollbackResultResponse = {
	status: string;
	data: RollbackResultData;
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

function formatActorLabel(actor: HistoryActor | null): string | null {
	if (!actor) return null;
	if (actor.name && actor.email) {
		return `${actor.name} <${actor.email}>`;
	}
	return actor.name ?? actor.email ?? actor.id ?? actor.type ?? null;
}

function rollbackResultActorFromJSON(value?: RollbackResultActorJson): RollbackResultActor | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value === 'string') {
		return {
			label: value,
			actor: null,
		};
	}

	if (typeof value === 'object') {
		const record = value as Record<string, unknown> & {
			actor?: HistoryActorJson | null;
			label?: string | null;
			type?: unknown;
			id?: unknown;
			name?: unknown;
			email?: unknown;
		};
		const isHistoryActorShape =
			'type' in record || 'id' in record || 'name' in record || 'email' in record;
		const actorSource = record.actor
			? record.actor
			: isHistoryActorShape
				? (record as HistoryActorJson)
				: undefined;
		const actor = actorSource ? historyActorFromJSON(actorSource) : null;
		const label =
			typeof record.label === 'string' && record.label.trim().length
				? (record.label as string)
				: formatActorLabel(actor);
		return {
			label: label ?? null,
			actor,
		};
	}

	return null;
}

function rollbackResultVariableFromJSON(json: RollbackResultVariableJson): RollbackResultVariable {
	return {
		name: json.name,
		version: typeof json.version === 'number' ? json.version : null,
		rolledBackToVersion:
			typeof json.rolled_back_to_version === 'number' ? json.rolled_back_to_version : null,
	};
}

export function rollbackResultFromJSON(json: RollbackResultResponseJson): RollbackResultResponse {
	return {
		status: json.status,
		data: {
			variable: rollbackResultVariableFromJSON(json.data.variable),
			previousHeadVersion:
				typeof json.data.previous_head_version === 'number'
					? json.data.previous_head_version
					: null,
			snapshotId: json.data.snapshot_id ?? null,
			updatedAtIso: json.data.updated_at ?? null,
			updatedBy: rollbackResultActorFromJSON(json.data.updated_by),
		},
	};
}
