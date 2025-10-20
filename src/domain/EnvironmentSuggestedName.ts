import type { EnvironmentSuggestedNameJson } from '@/types';

/**
 * Domain model for a suggested environment name.
 */
export class EnvironmentSuggestedName {
	constructor(public readonly name: string) {}

	static fromJSON(json: EnvironmentSuggestedNameJson): EnvironmentSuggestedName {
		return new EnvironmentSuggestedName(json.name);
	}

	/** User-facing label. */
	label(): string {
		return this.name;
	}
}
