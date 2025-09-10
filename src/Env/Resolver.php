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

        if (is_string($payload)) {
            $decoded = json_decode($payload, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $payload = $decoded;
            }
        }

        if (! is_array($payload) || ! isset($payload['data']) || ! is_array($payload['data'])) {
            throw new \RuntimeException('Unexpected response shape.');
        }

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
