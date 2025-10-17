import type { RuleDefinition } from './types.js';
import { isNumeric, parseNumber } from './utils.js';

const maxRule: RuleDefinition = {
	name: 'max',
	validate(value, rule) {
		const limit = parseNumber(rule.argument);
		if (limit === undefined) {
			return 'has an invalid max rule';
		}

		if (isNumeric(value)) {
			if (Number(value) > limit) {
				return `must be at most ${limit}`;
			}
			return undefined;
		}

		if (value.length > limit) {
			return `must be at most ${limit} characters long`;
		}

		return undefined;
	},
};

export default maxRule;
