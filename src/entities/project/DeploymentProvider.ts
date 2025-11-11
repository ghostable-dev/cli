export enum DeploymentProvider {
	LaravelCloud = 'laravel_cloud',
	LaravelForge = 'laravel_forge',
	LaravelVapor = 'laravel_vapor',
	Other = 'other',
}

type DeploymentProviderMeta = {
	label: string;
	description: string;
	url: string | null;
	htmlDescription: string;
};

const DEPLOYMENT_PROVIDER_META: Record<DeploymentProvider, DeploymentProviderMeta> = {
	[DeploymentProvider.LaravelCloud]: {
		label: 'Laravel Cloud',
		description: 'Hosted on Laravel Cloud.',
		url: 'https://laravel.com/cloud',
		htmlDescription:
			'<p>This project is hosted on <a href="https://laravel.com/cloud" target="_blank" rel="noopener noreferrer">Laravel Cloud</a>.</p>',
	},
	[DeploymentProvider.LaravelForge]: {
		label: 'Laravel Forge',
		description: 'Self-hosted through Laravel Forge.',
		url: 'https://forge.laravel.com',
		htmlDescription:
			'<p>This project is hosted via <a href="https://forge.laravel.com" target="_blank" rel="noopener noreferrer">Laravel Forge</a> on your servers.</p>',
	},
	[DeploymentProvider.LaravelVapor]: {
		label: 'Laravel Vapor',
		description: 'Serverless managed by Laravel Vapor.',
		url: 'https://vapor.laravel.com',
		htmlDescription:
			'<p>This project is serverless and managed by <a href="https://vapor.laravel.com" target="_blank" rel="noopener noreferrer">Laravel Vapor</a>.</p>',
	},
	[DeploymentProvider.Other]: {
		label: 'Other',
		description: 'Custom or third-party provider.',
		url: null,
		htmlDescription: '<p>This project uses a custom or third-party provider.</p>',
	},
};

export const deploymentProviderValues: DeploymentProvider[] = Object.values(DeploymentProvider);

export function deploymentProviderLabel(provider: DeploymentProvider): string {
	return DEPLOYMENT_PROVIDER_META[provider].label;
}

export function deploymentProviderDescription(provider: DeploymentProvider): string {
	return DEPLOYMENT_PROVIDER_META[provider].description;
}

export function deploymentProviderUrl(provider: DeploymentProvider): string | null {
	return DEPLOYMENT_PROVIDER_META[provider].url;
}

export function deploymentProviderHtmlDescription(provider: DeploymentProvider): string {
	return DEPLOYMENT_PROVIDER_META[provider].htmlDescription;
}

export function deploymentProviderMetadata(provider: DeploymentProvider): DeploymentProviderMeta {
	return DEPLOYMENT_PROVIDER_META[provider];
}

export function isDeploymentProvider(value: unknown): value is DeploymentProvider {
	return (
		typeof value === 'string' && deploymentProviderValues.includes(value as DeploymentProvider)
	);
}
