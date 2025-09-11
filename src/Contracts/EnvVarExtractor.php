<?php

namespace Ghostable\Contracts;

interface EnvVarExtractor
{
    /**
     * @param  array<string,mixed>  $payload
     * @param  bool|null  $skipComments  Override the instance default when non-null.
     * @return array<string,string>
     */
    public function extract(array $payload, ?bool $skipComments = null): array;
}
