<?php

namespace Ghostable\Contracts;

interface EnvStore
{
    /** @return array<int,string> */
    public function getRaw(string $name): array;

    public function save(string $name, string $contents): void;
}
