import type { RuleDefinition } from './types.js';

const integerRule: RuleDefinition = {
	name: 'integer',
	validate(value) {
		if (!/^[-+]?\d+$/.test(value.trim())) {
			return 'must be an integer value';
		}
		return undefined;
	},
};

export default integerRule;
