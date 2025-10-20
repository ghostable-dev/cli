import type { EnvironmentSecretBundleJson } from '@/types';
import { EnvironmentSecret } from './EnvironmentSecret.js';

/**
 * Domain model for a bundle of encrypted secrets merged across inheritance.
 */
export class EnvironmentSecretBundle {
	constructor(
		public readonly env: string,
		public readonly chain: readonly string[],
		public readonly secrets: readonly EnvironmentSecret[],
	) {}

	static fromJSON(json: EnvironmentSecretBundleJson): EnvironmentSecretBundle {
		const secrets = (json.secrets ?? []).map(EnvironmentSecret.fromJSON);
		return new EnvironmentSecretBundle(json.env, json.chain, secrets);
	}

	/** Returns the latest value version for a given key, if present. */
	secretByName(name: string): EnvironmentSecret | undefined {
		return this.secrets.find((s) => s.name === name);
	}
}
