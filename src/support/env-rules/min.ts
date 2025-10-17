import type { RuleDefinition } from './types.js';
import { isNumeric, parseNumber } from './utils.js';

const minRule: RuleDefinition = {
	name: 'min',
	validate(value, rule) {
		const limit = parseNumber(rule.argument);
		if (limit === undefined) {
			return 'has an invalid min rule';
		}

		if (isNumeric(value)) {
			if (Number(value) < limit) {
				return `must be at least ${limit}`;
			}
			return undefined;
		}

		if (value.length < limit) {
			return `must be at least ${limit} characters long`;
		}

		return undefined;
	},
};

export default minRule;
