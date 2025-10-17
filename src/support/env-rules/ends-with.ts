import type { RuleDefinition } from './types.js';
import { stripDelimiters } from './utils.js';

const endsWithRule: RuleDefinition = {
        name: 'ends_with',
        validate(value, rule) {
                const argument = stripDelimiters(rule.argument);
                if (!argument) {
                        return 'has an invalid ends_with rule';
                }
                if (!value.endsWith(argument)) {
                        return `must end with "${argument}"`;
                }
                return undefined;
        },
};

export default endsWithRule;
