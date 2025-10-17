import type { RuleDefinition } from './types.js';

const stringRule: RuleDefinition = {
	name: 'string',
	validate() {
		return undefined;
	},
};

export default stringRule;
