import type {
	EnvironmentSecretBundleJson,
	EnvironmentKey,
	EnvironmentKeyResourceJson,
} from '@/types';
import { environmentKeyFromJSON } from '@/types';
import { EnvironmentSecret } from './EnvironmentSecret.js';

/**
 * Domain model for a bundle of encrypted secrets merged across inheritance.
 */
export class EnvironmentSecretBundle {
	constructor(
		public readonly env: string,
		public readonly chain: readonly string[],
		public readonly secrets: readonly EnvironmentSecret[],
		public readonly environmentKey: EnvironmentKey | null = null,
	) {}

	static fromJSON(json: EnvironmentSecretBundleJson): EnvironmentSecretBundle {
		const secrets = (json.secrets ?? []).map(EnvironmentSecret.fromJSON);
		const rawEnvironmentKey =
			(json.environmentKey as
				| EnvironmentKey
				| { data?: EnvironmentKeyResourceJson | null }
				| null) ??
			(json.environment_key as
				| EnvironmentKeyResourceJson
				| { data?: EnvironmentKeyResourceJson | null }
				| null) ??
			null;

		let environmentKey: EnvironmentKey | null = null;
		const resourceLike =
			rawEnvironmentKey &&
			typeof rawEnvironmentKey === 'object' &&
			'data' in rawEnvironmentKey
				? (rawEnvironmentKey as { data?: EnvironmentKeyResourceJson | null }).data
				: rawEnvironmentKey;

		if (resourceLike) {
			if (typeof resourceLike === 'object' && 'attributes' in resourceLike) {
				environmentKey = environmentKeyFromJSON(resourceLike as EnvironmentKeyResourceJson);
			} else if (typeof resourceLike === 'object') {
				environmentKey = resourceLike as EnvironmentKey;
			}
		}

		return new EnvironmentSecretBundle(json.env, json.chain, secrets, environmentKey);
	}

	/** Returns the latest value version for a given key, if present. */
	secretByName(name: string): EnvironmentSecret | undefined {
		return this.secrets.find((s) => s.name === name);
	}
}
