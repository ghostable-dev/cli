import booleanRule from './boolean.js';
import emailRule from './email.js';
import endsWithRule from './ends-with.js';
import inRule from './in.js';
import integerRule from './integer.js';
import maxRule from './max.js';
import minRule from './min.js';
import nullableRule from './nullable.js';
import numericRule from './numeric.js';
import regexRule from './regex.js';
import requiredRule from './required.js';
import startsWithRule from './starts-with.js';
import stringRule from './string.js';
import urlRule from './url.js';
import type { RuleDefinition, RuleValidator } from './types.js';

const definitions: RuleDefinition[] = [
        booleanRule,
        emailRule,
        endsWithRule,
        inRule,
        integerRule,
        maxRule,
        minRule,
        nullableRule,
        numericRule,
        regexRule,
        requiredRule,
        startsWithRule,
        stringRule,
        urlRule,
];

const registry = new Map<string, RuleValidator>();
for (const { name, validate } of definitions) {
        registry.set(name, validate);
}

export function getRuleValidator(name: string): RuleValidator | undefined {
        return registry.get(name);
}
