import type { RuleDefinition } from './types.js';
import { stripDelimiters } from './utils.js';

const startsWithRule: RuleDefinition = {
        name: 'starts_with',
        validate(value, rule) {
                const argument = stripDelimiters(rule.argument);
                if (!argument) {
                        return 'has an invalid starts_with rule';
                }
                if (!value.startsWith(argument)) {
                        return `must start with "${argument}"`;
                }
                return undefined;
        },
};

export default startsWithRule;
