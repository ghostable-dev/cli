import type { HistoryActor, HistoryActorJson } from './history.js';

export type VariableContextClaimsJson = {
	hmac?: string | null;
};

export type VariableContextClaims = {
	hmac: string | null;
};

export type VariableContextEncryptedBodyJson = {
	ciphertext: string;
	nonce: string;
	alg: string;
	aad: Record<string, string>;
	claims?: VariableContextClaimsJson | null;
	client_sig?: string | null;
};

export type VariableContextEncryptedBody = {
	ciphertext: string;
	nonce: string;
	alg: string;
	aad: Record<string, string>;
	claims: VariableContextClaims | null;
	clientSig: string | null;
};

export type VariableContextNoteJson = {
	id: string;
	created_at?: string | null;
	updated_at?: string | null;
	created_by?: HistoryActorJson | null;
	last_updated_by?: HistoryActorJson | null;
	body: VariableContextEncryptedBodyJson;
};

export type VariableContextNote = {
	id: string;
	createdAt: string | null;
	updatedAt: string | null;
	createdBy: HistoryActor | null;
	lastUpdatedBy: HistoryActor | null;
	body: VariableContextEncryptedBody;
};

export type VariableContextCommentJson = {
	id: string;
	created_at?: string | null;
	created_by?: HistoryActorJson | null;
	body: VariableContextEncryptedBodyJson;
};

export type VariableContextComment = {
	id: string;
	createdAt: string | null;
	createdBy: HistoryActor | null;
	body: VariableContextEncryptedBody;
};

export type VariableContextPermissionsJson = {
	edit_note?: boolean | null;
	comment?: boolean | null;
	view_version_change_notes?: boolean | null;
};

export type VariableContextPermissions = {
	editNote: boolean;
	comment: boolean;
	viewVersionChangeNotes: boolean;
};

export type VariableContextEnvelopeResponseJson = {
	data: {
		scope?: string | null;
		environment: {
			id: string;
			name: string;
			type?: string | null;
		};
		variable: {
			id: string;
			name: string;
			latest_version?: number | null;
		};
		note?: VariableContextNoteJson | null;
		comments?: VariableContextCommentJson[] | null;
		permissions?: VariableContextPermissionsJson | null;
	};
};

export type VariableContextEnvelope = {
	scope: string | null;
	environment: {
		id: string;
		name: string;
		type: string | null;
	};
	variable: {
		id: string;
		name: string;
		latestVersion: number | null;
	};
	note: VariableContextNote | null;
	comments: VariableContextComment[];
	permissions: VariableContextPermissions;
};

export type VariableActionResponseJson = {
	status?: string | null;
	data?: {
		note_id?: string | null;
		comment_id?: string | null;
	} | null;
};

export type VariableActionResponse = {
	status: string | null;
	noteId: string | null;
	commentId: string | null;
};

function historyActorFromJSON(json?: HistoryActorJson | null): HistoryActor | null {
	if (!json) {
		return null;
	}

	return {
		type: json.type,
		id: json.id ?? null,
		name: json.name ?? null,
		email: json.email ?? null,
	};
}

export function variableContextEncryptedBodyFromJSON(
	json: VariableContextEncryptedBodyJson,
): VariableContextEncryptedBody {
	return {
		ciphertext: json.ciphertext,
		nonce: json.nonce,
		alg: json.alg,
		aad: json.aad ?? {},
		claims: json.claims
			? {
					hmac: json.claims.hmac ?? null,
				}
			: null,
		clientSig: json.client_sig ?? null,
	};
}

function variableContextNoteFromJSON(json: VariableContextNoteJson): VariableContextNote {
	return {
		id: json.id,
		createdAt: json.created_at ?? null,
		updatedAt: json.updated_at ?? null,
		createdBy: historyActorFromJSON(json.created_by),
		lastUpdatedBy: historyActorFromJSON(json.last_updated_by),
		body: variableContextEncryptedBodyFromJSON(json.body),
	};
}

function variableContextCommentFromJSON(json: VariableContextCommentJson): VariableContextComment {
	return {
		id: json.id,
		createdAt: json.created_at ?? null,
		createdBy: historyActorFromJSON(json.created_by),
		body: variableContextEncryptedBodyFromJSON(json.body),
	};
}

export function variableContextEnvelopeFromJSON(
	json: VariableContextEnvelopeResponseJson,
): VariableContextEnvelope {
	return {
		scope: json.data.scope ?? null,
		environment: {
			id: json.data.environment.id,
			name: json.data.environment.name,
			type: json.data.environment.type ?? null,
		},
		variable: {
			id: json.data.variable.id,
			name: json.data.variable.name,
			latestVersion:
				typeof json.data.variable.latest_version === 'number'
					? json.data.variable.latest_version
					: null,
		},
		note: json.data.note ? variableContextNoteFromJSON(json.data.note) : null,
		comments: (json.data.comments ?? []).map(variableContextCommentFromJSON),
		permissions: {
			editNote: Boolean(json.data.permissions?.edit_note),
			comment: Boolean(json.data.permissions?.comment),
			viewVersionChangeNotes: Boolean(json.data.permissions?.view_version_change_notes),
		},
	};
}

export function variableActionResponseFromJSON(
	json: VariableActionResponseJson,
): VariableActionResponse {
	return {
		status: json.status ?? null,
		noteId: json.data?.note_id ?? null,
		commentId: json.data?.comment_id ?? null,
	};
}
