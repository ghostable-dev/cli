/**
 * Utility functions for cryptographic operations.
 * Provides consistent Base64 encoding/decoding across the codebase.
 */

/** Converts a Uint8Array to a standard Base64 string (no prefix). */
export function toBase64(u8: Uint8Array): string {
	return Buffer.from(u8).toString('base64');
}

/** Converts a Base64 string to a Uint8Array. */
export function fromBase64(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'));
}
