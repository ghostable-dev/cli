<?php

declare(strict_types=1);

namespace Ghostable\Support;

use Ghostable\Contracts\EnvVarExtractor;

final class DefaultEnvVarExtractor implements EnvVarExtractor
{
    public function __construct(
        private readonly bool $skipComments = true,
    ) {}

    public function extract(array $payload, ?bool $skipComments = null): array
    {
        $vars = [];
        $skip = $skipComments ?? $this->skipComments;

        foreach ($payload as $row) {
            if (! \is_array($row) || ! \array_key_exists('key', $row)) {
                continue;
            }

            if ($skip && isset($row['is_commented']) && $this->toBool($row['is_commented'])) {
                continue;
            }

            $k = (string) $row['key'];
            $v = \array_key_exists('value', $row) ? (string) $row['value'] : '';
            $vars[$k] = $v; // last-wins on duplicate keys
        }

        return $vars;
    }

    private function toBool(mixed $v): bool
    {
        if (\is_bool($v)) {
            return $v;
        }
        if (\is_int($v)) {
            return $v === 1;
        }
        if (\is_string($v)) {
            $s = \strtolower($v);

            return $v === '1' || $s === 'true';
        }

        return false;
    }
}
