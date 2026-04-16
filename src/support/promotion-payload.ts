import type { SignedEnvironmentSecretUploadRequest } from '@/ghostable/types/environment.js';

export function buildPromotionPayloadSigningJSON(
	payload: SignedEnvironmentSecretUploadRequest,
): string {
	const { client_sig: clientSignature, ...unsignedPayload } = payload;
	void clientSignature;
	return JSON.stringify(unsignedPayload);
}
