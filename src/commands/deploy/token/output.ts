import boxen from 'boxen';
import chalk from 'chalk';

import { formatDateTimeWithRelative } from '../../../support/dates.js';

import type { DeploymentTokenWithSecret } from '@/ghostable/types/deploy-token.js';

type DeploymentTokenSummaryOptions = {
	result: DeploymentTokenWithSecret;
	environmentName: string;
	privateKeyB64: string;
	includeInlinePrivateKey: boolean;
	privateKeyPath?: string;
};

export function buildDeploymentTokenSummaryLines(opts: DeploymentTokenSummaryOptions): string[] {
	const { result, environmentName, privateKeyB64, includeInlinePrivateKey, privateKeyPath } =
		opts;

	const expiresLabel = result.apiToken
		? result.apiToken.expiresAt
			? formatDateTimeWithRelative(result.apiToken.expiresAt)
			: 'Does not expire'
		: 'N/A';

	const lines = [
		`${chalk.dim('Token ID:')} ${result.token.id}`,
		`${chalk.dim('Environment:')} ${environmentName}`,
		`${chalk.dim('Token Expires:')} ${expiresLabel}`,
	];

	if (result.apiToken?.tokenSuffix) {
		lines.push(`${chalk.dim('Token Suffix:')} ${result.apiToken.tokenSuffix}`);
	}

	const appendSection = (section: string[]) => {
		if (!section.length) {
			return;
		}
		if (lines[lines.length - 1] !== '') {
			lines.push('');
		}
		lines.push(...section);
	};

	const apiTokenPlainText = result.apiToken?.plainText ?? result.secret;
	const envVarSection: string[] = [];

	if (apiTokenPlainText) {
		envVarSection.push(`${chalk.dim('GHOSTABLE_CI_TOKEN=')}"${apiTokenPlainText}"`);
	}

	if (includeInlinePrivateKey) {
		envVarSection.push(`${chalk.dim('GHOSTABLE_DEPLOY_SEED=')}"${privateKeyB64}"`);
	}

	appendSection(envVarSection);

	if (privateKeyPath) {
		appendSection([
			`${chalk.dim('Private key written to:')} ${privateKeyPath}`,
			'Set GHOSTABLE_DEPLOY_SEED in your CI to the contents of this private key file.',
		]);
	}

	const warningBox = boxen('Store this information securely — it cannot be retrieved again.', {
		padding: { top: 0, bottom: 0, left: 1, right: 1 },
		margin: 0,
		borderColor: 'yellow',
		borderStyle: 'round',
	});

	lines.push('');
	lines.push(warningBox);

	return lines;
}
