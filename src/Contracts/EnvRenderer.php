<?php

namespace Ghostable\Contracts;

interface EnvRenderer
{
    /**
     * Render a full set of env vars.
     *
     * @param  array<string,string>  $vars
     * @param  'dotenv'|'shell'  $format
     * @param  array<int,string>|null  $onlyKeys  If provided, enforce exact order and fail on missing
     */
    public function render(
        array $vars,
        string $format = 'dotenv',
        ?array $onlyKeys = null,
        bool $sort = true,
        bool $redact = true,
        bool $newline = true
    ): string;

    /**
     * Render a single key value.
     *
     * @throws \RuntimeException if key missing
     */
    public function renderSingle(
        array $vars,
        string $key,
        string $format = 'dotenv',
        bool $redact = true,
        bool $newline = true
    ): string;
}
