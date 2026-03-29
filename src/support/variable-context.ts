import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';

import { b64, deriveKeys, edSign, hmacSHA256, randomBytes, ub64 } from '@/crypto';
import type { VariableContextEncryptedBodyJson } from '@/ghostable/types/variable-context.js';

export type VariableContextScope = 'note' | 'comment' | 'change_note';

const CONTEXT_AAD_KEYS = ['env', 'org', 'project', 'scope', 'variable'] as const;

function escapeJSON(value: string): string {
	return JSON.stringify(value).slice(1, -1);
}

export function variableContextAAD(opts: {
	orgId: string;
	projectId: string;
	environmentName: string;
	variableName: string;
	scope: VariableContextScope;
}): Record<string, string> {
	return {
		env: opts.environmentName,
		org: opts.orgId,
		project: opts.projectId,
		scope: opts.scope,
		variable: opts.variableName,
	};
}

function canonicalContextAADBytes(aad: Record<string, string>): Uint8Array {
	const ordered: Record<string, string> = {};

	for (const key of CONTEXT_AAD_KEYS) {
		const value = aad[key];
		if (value !== undefined) {
			ordered[key] = value;
		}
	}

	const remainingKeys = Object.keys(aad)
		.filter((key) => !CONTEXT_AAD_KEYS.includes(key as (typeof CONTEXT_AAD_KEYS)[number]))
		.sort((left, right) => left.localeCompare(right));

	for (const key of remainingKeys) {
		ordered[key] = aad[key]!;
	}

	return new TextEncoder().encode(JSON.stringify(ordered));
}

function variableContextScopePath(
	orgId: string,
	projectId: string,
	environmentName: string,
	variableName: string,
	scope: VariableContextScope,
): string {
	return `${orgId}/${projectId}/${environmentName}/context/${variableName}/${scope}`;
}

export function jsonStringForVariableContextBody(
	body: VariableContextEncryptedBodyJson,
	includeClientSig: boolean,
): string {
	const fields = [
		`"ciphertext":"${escapeJSON(body.ciphertext)}"`,
		`"nonce":"${escapeJSON(body.nonce)}"`,
		`"alg":"${escapeJSON(body.alg)}"`,
		`"aad":${aadJSONString(body.aad)}`,
	];

	if (body.claims?.hmac) {
		fields.push(`"claims":{"hmac":"${escapeJSON(body.claims.hmac)}"}`);
	}

	if (includeClientSig && body.client_sig) {
		fields.push(`"client_sig":"${escapeJSON(body.client_sig)}"`);
	}

	return `{${fields.join(',')}}`;
}

function aadJSONString(aad: Record<string, string>): string {
	const parts: string[] = [];

	for (const key of CONTEXT_AAD_KEYS) {
		const value = aad[key];
		if (value !== undefined) {
			parts.push(`"${escapeJSON(key)}":"${escapeJSON(value)}"`);
		}
	}

	const remainingKeys = Object.keys(aad)
		.filter((key) => !CONTEXT_AAD_KEYS.includes(key as (typeof CONTEXT_AAD_KEYS)[number]))
		.sort((left, right) => left.localeCompare(right));

	for (const key of remainingKeys) {
		parts.push(`"${escapeJSON(key)}":"${escapeJSON(aad[key]!)}"`);
	}

	return `{${parts.join(',')}}`;
}

export async function buildEncryptedVariableContextBody(opts: {
	orgId: string;
	projectId: string;
	environmentName: string;
	variableName: string;
	scope: VariableContextScope;
	plaintext: string;
	keyMaterial: Uint8Array;
	signingPrivateKey: Uint8Array;
}): Promise<VariableContextEncryptedBodyJson> {
	const aad = variableContextAAD(opts);
	const derived = deriveKeys(
		opts.keyMaterial,
		variableContextScopePath(
			opts.orgId,
			opts.projectId,
			opts.environmentName,
			opts.variableName,
			opts.scope,
		),
	);
	const plaintextBytes = new TextEncoder().encode(opts.plaintext);
	const nonce = randomBytes(24);
	const cipher = new XChaCha20Poly1305(derived.encKey);
	const ciphertext = cipher.seal(nonce, plaintextBytes, canonicalContextAADBytes(aad));
	const claims = {
		hmac: hmacSHA256(derived.hmacKey, plaintextBytes),
	};

	const unsignedBody: VariableContextEncryptedBodyJson = {
		ciphertext: `b64:${b64(ciphertext)}`,
		nonce: `b64:${b64(nonce)}`,
		alg: 'xchacha20-poly1305',
		aad,
		claims,
	};

	const signaturePayload = new TextEncoder().encode(
		jsonStringForVariableContextBody(unsignedBody, false),
	);
	const signature = await edSign(opts.signingPrivateKey, signaturePayload);

	return {
		...unsignedBody,
		client_sig: b64(signature),
	};
}

export function decryptVariableContextBody(
	body: VariableContextEncryptedBodyJson,
	keyMaterial: Uint8Array,
): string {
	const orgId = body.aad.org ?? '';
	const projectId = body.aad.project ?? '';
	const environmentName = body.aad.env ?? '';
	const variableName = body.aad.variable ?? '';
	const scope = (body.aad.scope ?? 'note') as VariableContextScope;
	const derived = deriveKeys(
		keyMaterial,
		variableContextScopePath(orgId, projectId, environmentName, variableName, scope),
	);

	const cipher = new XChaCha20Poly1305(derived.encKey);
	const plaintext = cipher.open(
		ub64(body.nonce),
		ub64(body.ciphertext),
		canonicalContextAADBytes(body.aad),
	);

	if (!plaintext) {
		throw new Error('Failed to decrypt variable context.');
	}

	if (body.claims?.hmac) {
		const expected = hmacSHA256(derived.hmacKey, plaintext);
		if (expected !== body.claims.hmac) {
			throw new Error('Variable context integrity check failed.');
		}
	}

	return new TextDecoder().decode(plaintext);
}

export function buildVariableContextRequestPayload(
	deviceId: string,
	fieldName: 'note' | 'comment',
	body: VariableContextEncryptedBodyJson,
): {
	device_id: string;
	note?: VariableContextEncryptedBodyJson;
	comment?: VariableContextEncryptedBodyJson;
} {
	return {
		device_id: deviceId,
		[fieldName]: body,
	};
}
