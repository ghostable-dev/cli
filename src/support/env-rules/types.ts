export type ParsedRule = {
        type: string;
        argument?: string;
};

export type RuleValidator = (value: string, rule: ParsedRule) => string | undefined;

export type RuleDefinition = {
        name: string;
        validate: RuleValidator;
};
