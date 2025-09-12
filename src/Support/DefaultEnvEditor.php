<?php

namespace Ghostable\Support;

use Ghostable\Contracts\EnvEditor;
use Ghostable\Contracts\EnvRenderer;
use Ghostable\Contracts\EnvStore;

final class DefaultEnvEditor implements EnvEditor
{
    public function __construct(
        private readonly EnvStore $env,
        private readonly EnvRenderer $renderer
    ) {}

    public function merge(string $profile, array $vars): void
    {
        $lines = $this->safeReadLines($profile);

        // Build index of existing KEY => lineNumber
        $indices = [];
        foreach ($lines as $i => $line) {
            if (preg_match('/^\s*([A-Za-z0-9_]+)\s*=/', $line, $m)) {
                $indices[$m[1]] = $i;
            }
        }

        foreach ($vars as $key => $value) {
            if ($value === null) {
                // Remove the key entirely if present
                if (array_key_exists($key, $indices)) {
                    unset($lines[$indices[$key]]);
                    // reindex after deletion so later positions don't go stale
                    $lines = array_values($lines);
                    $indices = $this->reindex($lines);
                }

                continue;
            }

            // Use renderer for the value; we assemble KEY=VALUE here to keep renderer pure
            $escaped = $this->renderer->renderSingle([$key => $value], $key, 'dotenv', false, false);
            $newLine = $key.'='.$escaped;

            if (array_key_exists($key, $indices)) {
                $lines[$indices[$key]] = $newLine;
            } else {
                // If last line is non-empty and not a KV, add a blank line for readability
                if ($lines !== [] && trim(end($lines)) !== '' && ! preg_match('/^\s*[A-Za-z0-9_]+\s*=/', end($lines))) {
                    $lines[] = '';
                }
                $lines[] = $newLine;
                // keep index map fresh for subsequent keys
                $indices[$key] = array_key_last($lines);
            }
        }

        // Always end with a single trailing newline
        $contents = rtrim(implode(PHP_EOL, $lines), "\r\n").PHP_EOL;

        $this->env->save($profile, $contents);
    }

    public function plan(string $profile, array $vars): array
    {
        $lines = $this->safeReadLines($profile);

        $existing = [];
        foreach ($lines as $line) {
            if (preg_match('/^\s*([A-Za-z0-9_]+)\s*=/', $line, $m)) {
                $existing[$m[1]] = true;
            }
        }

        $add = $update = $remove = [];

        foreach ($vars as $k => $v) {
            if ($v === null) {
                if (isset($existing[$k])) {
                    $remove[] = $k;
                }

                continue;
            }
            if (isset($existing[$k])) {
                $update[] = $k;
            } else {
                $add[] = $k;
            }
        }

        sort($add);
        sort($update);
        sort($remove);

        return compact('add', 'update', 'remove');
    }

    /** @return array<int,string> */
    private function safeReadLines(string $profile): array
    {
        try {
            return $this->env->getRaw($profile);
        } catch (\Throwable) {
            return [];
        }
    }

    /** @param array<int,string> $lines @return array<string,int> */
    private function reindex(array $lines): array
    {
        $idx = [];
        foreach ($lines as $i => $line) {
            if (preg_match('/^\s*([A-Za-z0-9_]+)\s*=/', $line, $m)) {
                $idx[$m[1]] = $i;
            }
        }

        return $idx;
    }
}
