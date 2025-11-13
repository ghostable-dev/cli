import { describe, expect, it } from 'vitest';

import { EnvFileFormat, renderEnvFile } from '../src/environment/files/env-format.js';

describe('renderEnvFile dependency ordering', () => {
	it('orders dependencies before dependents in alphabetical format', () => {
		const content = renderEnvFile(
			[
				{ key: 'ALPHA_URL', value: '${ZETA_DOMAIN}/app' },
				{ key: 'ZETA_DOMAIN', value: 'example.com' },
			],
			{ format: EnvFileFormat.ALPHABETICAL },
		);

		expect(content).toBe('ZETA_DOMAIN=example.com\nALPHA_URL=${ZETA_DOMAIN}/app\n');
	});

	it('reorders grouped sections when cross-prefix dependencies exist', () => {
		const content = renderEnvFile(
			[
				{ key: 'ALPHA_DEP', value: '${ZETA_VALUE}' },
				{ key: 'APP_ID', value: '1' },
				{ key: 'ZETA_VALUE', value: 'secret' },
			],
			{ format: EnvFileFormat.GROUPED_COMMENTS },
		);

		expect(content).toContain('# ZETA\nZETA_VALUE=secret');
		expect(content).toContain('# ALPHA\nALPHA_DEP=${ZETA_VALUE}');
		expect(content.indexOf('# ZETA')).toBeGreaterThan(-1);
		expect(content.indexOf('# ALPHA')).toBeGreaterThan(-1);
		expect(content.indexOf('# ZETA')).toBeLessThan(content.indexOf('# ALPHA'));
	});
});
