<?php

namespace Ghostable\Api;

class V2Adapter implements Adapter
{
    public function uri(string $endpoint): string
    {
        return '/api/v2'.'/'.ltrim($endpoint, '/');
    }

    public function version(): string
    {
        return 'v2';
    }
}
