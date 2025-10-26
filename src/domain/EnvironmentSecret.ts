import type { EnvironmentSecretJson, AAD, CipherAlg, Claims } from '@/types';

/**
 * Domain model for a single encrypted environment secret.
 */
export class EnvironmentSecret {
	constructor(
		public readonly env: string,
		public readonly name: string,
		public readonly ciphertext: string,
		public readonly nonce: string,
		public readonly alg: CipherAlg,
		public readonly aad: AAD,
		public readonly claims?: Claims,
		public readonly version?: number,
		public readonly envKekVersion?: number,
		public readonly envKekFingerprint?: string | null,
		public readonly meta?: {
			line_bytes?: number;
			is_vapor_secret?: boolean;
			is_commented?: boolean;
			is_override?: boolean;
		},
	) {}

	static fromJSON(json: EnvironmentSecretJson): EnvironmentSecret {
		return new EnvironmentSecret(
			json.env,
			json.name,
			json.ciphertext,
			json.nonce,
			json.alg,
			json.aad,
			json.claims,
			json.version,
			json.env_kek_version ?? undefined,
			json.env_kek_fingerprint ?? null,
			json.meta,
		);
	}
}
