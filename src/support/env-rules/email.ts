import type { RuleDefinition } from './types.js';

const emailRule: RuleDefinition = {
        name: 'email',
        validate(value) {
                const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!pattern.test(value)) {
                        return 'must be a valid email address';
                }
                return undefined;
        },
};

export default emailRule;
