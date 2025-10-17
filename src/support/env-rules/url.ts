import type { RuleDefinition } from './types.js';

const urlRule: RuleDefinition = {
        name: 'url',
        validate(value) {
                try {
                        new URL(value);
                        return undefined;
                } catch {
                        return 'must be a valid URL';
                }
        },
};

export default urlRule;
