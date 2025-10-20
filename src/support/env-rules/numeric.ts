import type { RuleDefinition } from './types.js';
import { isNumeric } from './utils.js';

const numericRule: RuleDefinition = {
	name: 'numeric',
	validate(value) {
		if (!isNumeric(value)) {
			return 'must be numeric';
		}
		return undefined;
	},
};

export default numericRule;
