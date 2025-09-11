<?php

namespace Ghostable\Contracts;

/**
 * Builds a child process environment by merging provided vars with the host env.
 */
interface EnvBuilder
{
    /**
     * @param  array<string,string|null>  $vars  Vars to inject (null unsets when supported)
     * @param  bool  $protectSystem  Skip overriding critical vars like PATH/HOME
     * @return array<string,string> Final env map for a child process
     */
    public function build(array $vars, bool $protectSystem = true): array;
}
