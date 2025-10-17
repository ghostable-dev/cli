import type { RuleDefinition } from './types.js';

const nullableRule: RuleDefinition = {
        name: 'nullable',
        validate() {
                return undefined;
        },
};

export default nullableRule;
