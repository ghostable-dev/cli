<?php

namespace Ghostable\Contracts;

interface EnvEditor
{
    /**
     * Merge the given key=>value map into the target env file.
     * - null value => delete key
     * - non-null => upsert/replace
     *
     * @param  array<string, string|null>  $vars
     */
    public function merge(string $profile, array $vars): void;

    /**
     * Produce a plan (no writes): which keys will be added/updated/removed.
     *
     * @return array{add: string[], update: string[], remove: string[]}
     */
    public function plan(string $profile, array $vars): array;
}
