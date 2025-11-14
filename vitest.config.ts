import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	resolve: {
		alias: [
			{ find: '@', replacement: path.resolve(__dirname, 'src') },
			{ find: '@/crypto', replacement: path.resolve(__dirname, 'src/crypto') },
			{ find: '@/types', replacement: path.resolve(__dirname, 'src/types') },
			{ find: '@/entities', replacement: path.resolve(__dirname, 'src/entities') },
			{ find: '@/ghostable', replacement: path.resolve(__dirname, 'src/ghostable') },
		],
	},
	test: {
		setupFiles: ['test/setup.ts'],
	},
});
