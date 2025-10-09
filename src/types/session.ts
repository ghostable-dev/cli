/**
 * Represents a local CLI session persisted between runs.
 */
export interface Session {
	/** Bearer token used for authenticated requests. */
	accessToken: string;

	/** Organization currently in context (if any). */
	organizationId?: string;

	/** Expiry timestamp (ISO 8601 string). */
	expiresAt?: string;
}
