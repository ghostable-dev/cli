import type { RuleDefinition } from './types.js';
import { parseList } from './utils.js';

const inRule: RuleDefinition = {
        name: 'in',
        validate(value, rule) {
                const candidates = parseList(rule.argument);
                if (!candidates.length) {
                        return 'has an invalid in rule';
                }
                if (!candidates.includes(value)) {
                        return `must be one of: ${candidates.join(', ')}`;
                }
                return undefined;
        },
};

export default inRule;
