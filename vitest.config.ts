import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	resolve: {
		alias: [
			{ find: '@', replacement: path.resolve(__dirname, 'src') },
			{ find: '@/crypto', replacement: path.resolve(__dirname, 'src/crypto') },
			{ find: '@/types', replacement: path.resolve(__dirname, 'src/types') },
			{ find: '@/domain', replacement: path.resolve(__dirname, 'src/domain') },
			{ find: '@/ghostable', replacement: path.resolve(__dirname, 'src/ghostable') },
		],
	},
	test: {
		setupFiles: ['test/setup.ts'],
	},
});
