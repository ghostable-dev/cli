export type DeploymentTokenStatus = 'active' | 'revoked';

export type DeploymentToken = {
	id: string;
	name: string;
	status: DeploymentTokenStatus;
	publicKey: string;
	fingerprint: string | null;
	lastUsedAt: Date | null;
	createdAt: Date;
	updatedAt: Date | null;
	revokedAt: Date | null;
	environmentId: string;
	environmentName: string;
};

export function isDeploymentTokenActive(token: DeploymentToken): boolean {
	return token.status === 'active' && !token.revokedAt;
}

export function formatDeploymentTokenLabel(token: DeploymentToken): string {
	const envPart = token.environmentName ? ` (${token.environmentName})` : '';
	return `${token.name}${envPart}`;
}
