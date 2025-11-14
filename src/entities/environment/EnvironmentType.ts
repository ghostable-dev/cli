import type { EnvironmentTypeJson } from '@/ghostable/types/environment.js';

/**
 * Domain model for an environment type.
 */
export class EnvironmentType {
	constructor(
		public readonly value: string,
		public readonly labelText: string,
	) {}

	static fromJSON(json: EnvironmentTypeJson): EnvironmentType {
		return new EnvironmentType(json.value, json.label);
	}

	/** User-facing label. */
	label(): string {
		return this.labelText;
	}
}
