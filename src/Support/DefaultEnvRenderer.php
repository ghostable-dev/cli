<?php

namespace Ghostable\Support;

use Ghostable\Contracts\EnvRenderer;
use RuntimeException;

final class DefaultEnvRenderer implements EnvRenderer
{
    private const REDACTED_PLACEHOLDER = 'REDACTED';

    public function render(
        array $vars,
        string $format = 'dotenv',
        ?array $onlyKeys = null,
        bool $sort = true,
        bool $redact = true,
        bool $newline = true
    ): string {
        $order = $onlyKeys ? $this->enforceKeyOrderOrFail($vars, $onlyKeys) : array_keys($vars);

        if ($sort && ! $onlyKeys) {
            natcasesort($order);
            $order = array_values($order);
        }

        $lines = [];
        foreach ($order as $k) {
            $v = $redact ? self::REDACTED_PLACEHOLDER : ($vars[$k] ?? '');
            $lines[] = $format === 'shell'
                ? 'export '.$k.'='.$this->escapeShell($v)
                : $k.'='.$this->escapeDotenv($v);
        }

        $out = implode("\n", $lines);

        return $newline ? $out."\n" : $out;
    }

    public function renderSingle(
        array $vars,
        string $key,
        string $format = 'dotenv',
        bool $redact = true,
        bool $newline = true
    ): string {
        if (! array_key_exists($key, $vars)) {
            throw new RuntimeException('ERR[2] Missing required keys: '.$key);
        }

        $v = $redact ? self::REDACTED_PLACEHOLDER : $vars[$key];

        $out = $format === 'shell'
            ? ($key.'='.$this->escapeShell($v))
            : ($this->escapeDotenv($v));

        return $newline ? $out."\n" : $out;
    }

    /** @return array<int,string> */
    private function enforceKeyOrderOrFail(array $vars, array $required): array
    {
        $order = [];

        $missing = [];

        foreach ($required as $k) {
            if (array_key_exists($k, $vars)) {
                $order[] = $k;
            } else {
                $missing[] = $k;
            }
        }

        if ($missing) {
            throw new RuntimeException('ERR[2] Missing required keys: '.implode(', ', $missing));
        }

        return $order;
    }

    private function escapeDotenv(string $value): string
    {
        $value = str_replace("\n", '\\n', $value);

        $needsQuotes = (bool) preg_match('/\s|#|=|"|\\\\|[^\x20-\x7E]/', $value);

        if ($needsQuotes) {
            $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $value);

            return '"'.$escaped.'"';
        }

        return $value;
    }

    private function escapeShell(string $value): string
    {
        $value = str_replace("\n", '\\n', $value);

        return "'".str_replace("'", "'\\''", $value)."'";
    }
}
