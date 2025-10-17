import type { RuleDefinition } from './types.js';

const valid = ['true', 'false', '1', '0'];

const booleanRule: RuleDefinition = {
	name: 'boolean',
	validate(value) {
		const normalized = value.toLowerCase();
		if (!valid.includes(normalized)) {
			return 'must be a boolean (true/false or 1/0)';
		}
		return undefined;
	},
};

export default booleanRule;
