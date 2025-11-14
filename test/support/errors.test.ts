import { describe, expect, it } from 'vitest';

import { HttpError } from '../../src/ghostable/http/errors.js';
import { toErrorMessage } from '../../src/support/errors.js';

describe('toErrorMessage', () => {
	it('returns a friendly message for expired sessions', () => {
		const body = JSON.stringify({
			error: {
				code: 'GHO-AUTH-0001',
				detail: 'Unauthenticated.',
			},
		});
		const error = new HttpError(401, body, 'GET /projects/1 failed');

		expect(toErrorMessage(error)).toBe(
			'Authentication failed (401): Unauthenticated. Run `ghostable login` to sign in again.',
		);
	});

	it('falls back to body text if a 401 response is not JSON', () => {
		const error = new HttpError(401, 'Token expired', 'GET /projects/1 failed');

		expect(toErrorMessage(error)).toBe(
			'Authentication failed (401): Token expired Run `ghostable login` to sign in again.',
		);
	});
});
