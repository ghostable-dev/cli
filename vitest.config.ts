import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
			'@/crypto': path.resolve(__dirname, 'src/crypto/index.ts'),
			'@/types': path.resolve(__dirname, 'src/types/index.ts'),
			'@/domain': path.resolve(__dirname, 'src/domain/index.ts'),
		},
	},
	test: {
		setupFiles: ['test/setup.ts'],
	},
});
