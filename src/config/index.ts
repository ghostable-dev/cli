import 'dotenv/config';
import { KEYCHAIN_SERVICE_SESSION } from '@/keychain';

export interface AppConfig {
	apiBase: string;
	keychainService: string;
	keychainAccount: string;
}

export const config: AppConfig = {
	apiBase: process.env.GHOSTABLE_API ?? 'https://ghostable.dev/api/v2',
	keychainService: KEYCHAIN_SERVICE_SESSION,
	keychainAccount: 'session',
};
