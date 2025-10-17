import type { RuleDefinition } from './types.js';
import { buildRegex } from './utils.js';

const regexRule: RuleDefinition = {
        name: 'regex',
        validate(value, rule) {
                const pattern = buildRegex(rule.argument);
                if (!pattern) {
                        return 'has an invalid regex rule';
                }
                if (!pattern.test(value)) {
                        return `must match regex ${pattern}`;
                }
                return undefined;
        },
};

export default regexRule;
