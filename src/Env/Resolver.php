<?php

namespace Ghostable\Env;

use Ghostable\GhostableConsoleClient;
use Ghostable\Manifest;

class Resolver
{
    /**
     * Fetch environment variables from the Ghostable API and return a map of key => value.
     *
     * @return array<string,string>
     */
    public static function resolve(GhostableConsoleClient $client, string $env): array
    {
        $payload = $client->fetch(Manifest::id(), $env);

        $vars = [];
        foreach ($payload['data'] as $row) {
            if (! isset($row['key'])) {
                continue;
            }
            if (isset($row['is_commented']) && (int) $row['is_commented'] === 1) {
                continue;
            }
            $k = (string) $row['key'];
            $v = isset($row['value']) ? (string) $row['value'] : '';
            $vars[$k] = $v;
        }

        return $vars;
    }
}
