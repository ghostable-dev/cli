import type { ProjectJson } from '@/ghostable/types/project.js';
import type { EnvironmentJson } from '@/ghostable/types/environment.js';
import { Environment } from './environment/Environment.js';
import { DeploymentProvider, isDeploymentProvider } from './project/DeploymentProvider.js';

/**
 * Domain model for a Project.
 * Normalizes IDs, timestamps, and nested environments.
 */
export class Project {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly slug: string,
		public readonly organizationId: string,
		public readonly deploymentProvider: DeploymentProvider,
		public readonly environments: ReadonlyArray<Environment>,
		public readonly createdAt: Date,
		public readonly updatedAt: Date,
	) {}

	static fromJSON(json: ProjectJson): Project {
		const envs: ReadonlyArray<Environment> = Array.isArray(json.environments)
			? json.environments.map((e: EnvironmentJson) => Environment.fromJSON(e))
			: [];

		return new Project(
			json.id,
			json.name,
			json.slug,
			json.organization_id,
			isDeploymentProvider(json.deployment_provider)
				? json.deployment_provider
				: DeploymentProvider.Other,
			envs,
			new Date(json.created_at),
			new Date(json.updated_at),
		);
	}

	/** User-facing label. */
	label(): string {
		return this.name;
	}
}
