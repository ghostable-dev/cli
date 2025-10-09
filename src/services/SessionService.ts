import keytar from 'keytar';
import { config } from '../config/index.js';
import type { Session } from '@/types';

export class SessionService {
	async load(): Promise<Session | null> {
		const raw = await keytar.getPassword(config.keychainService, config.keychainAccount);
		return raw ? (JSON.parse(raw) as Session) : null;
	}

	async save(sess: Session): Promise<void> {
		await keytar.setPassword(
			config.keychainService,
			config.keychainAccount,
			JSON.stringify(sess),
		);
	}

	async clear(): Promise<void> {
		await keytar.deletePassword(config.keychainService, config.keychainAccount);
	}
}
