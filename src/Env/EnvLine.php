<?php

namespace Ghostable\Env;

class EnvLine
{
    public function __construct(
        public EnvLineType $type,
        public ?string $key = null,
        public ?string $value = null,
        public bool $commented = false,
        public string $raw = '',
        public ?string $error = null,
    ) {}

    public function isValid(): bool
    {
        return $this->type === EnvLineType::ENV;
    }

    public function toArray(): array
    {
        return [
            'type' => $this->type->value,
            'key' => $this->key,
            'value' => $this->value,
            'commented' => $this->commented,
            'raw' => $this->raw,
            'error' => $this->error,
        ];
    }
}
