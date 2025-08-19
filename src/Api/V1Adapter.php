<?php

namespace Ghostable\Api;

class V1Adapter implements Adapter
{
    public function uri(string $endpoint): string
    {
        return '/api/v1'.'/'.ltrim($endpoint, '/');
    }

    public function version(): string
    {
        return 'v1';
    }
}
