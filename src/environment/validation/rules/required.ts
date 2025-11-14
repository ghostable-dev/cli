import type { RuleDefinition } from './types.js';

const requiredRule: RuleDefinition = {
	name: 'required',
	validate() {
		return undefined;
	},
};

export default requiredRule;
