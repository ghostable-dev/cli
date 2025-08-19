<?php

namespace Ghostable\Api;

interface Adapter
{
    /**
     * Get the fully-qualified URI for the given endpoint, including the API version prefix.
     */
    public function uri(string $endpoint): string;

    /**
     * Get the API version string (e.g., "v1").
     */
    public function version(): string;
}
