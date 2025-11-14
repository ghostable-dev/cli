export type Keytar = {
	getPassword(service: string, account: string): Promise<string | null>;
	setPassword(service: string, account: string, password: string): Promise<void>;
	deletePassword(service: string, account: string): Promise<boolean>;
};

const DEPLOY_COMMANDS = new Set([
	'deploy',
	'deploy:forge',
	'deploy:cloud',
	'deploy:vapor',
	'deploy-token',
	'env:deploy',
]);

function isEnvNamespaceDeploy(argv: string[]): boolean {
	for (let i = 0; i < argv.length; i += 1) {
		const current = argv[i];
		if (current === 'env:deploy') return true;
		if (current === 'env' || current === 'environment') {
			const next = argv[i + 1];
			if (next === 'deploy') return true;
		}
	}
	return false;
}

function argvHasToken(argv: string[]): boolean {
	return argv.includes('--token') || argv.some((a) => a.startsWith('--token='));
}

function isDeployTokenCommand(argv: string[]): boolean {
	for (let i = 0; i < argv.length; i += 1) {
		const current = argv[i];
		if (current === 'deploy-token') return true;
		if (current === 'deploy' && (argv[i + 1] === 'token' || argv[i + 1] === 'tokens')) {
			return true;
		}
	}
	return false;
}

function isDeployCommand(argv: string[]): boolean {
	// naive but reliable enough for Commander-style CLIs
	return argv.some((a) => DEPLOY_COMMANDS.has(a)) || isEnvNamespaceDeploy(argv);
}

/**
 * Only allow OS keychain when we're *not* deploying and no token was provided.
 * If a deploy command is detected OR a token is passed via flag/env, we disable keychain.
 */
export function allowKeyring(argv: string[] = process.argv.slice(2)): boolean {
	if (isDeployTokenCommand(argv)) return true;
	if (argvHasToken(argv)) return false;
	if (process.env.GHOSTABLE_CI_TOKEN?.trim()) return false;
	if (isDeployCommand(argv)) return false;
	return true;
}

export async function loadKeytar(argv: string[] = process.argv.slice(2)): Promise<Keytar | null> {
	if (!allowKeyring(argv)) return null;
	try {
		const mod = await import('keytar');
		return (mod.default ?? mod) as Keytar;
	} catch {
		return null; // missing native lib or not installed: treat as unavailable
	}
}
