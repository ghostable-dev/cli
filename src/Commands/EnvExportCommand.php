<?php

namespace Ghostable\Commands;

use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\ConsoleOutputInterface;

class EnvExportCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:export')
            ->setDescription('Print resolved environment variables')
            // options + shortcuts
            ->addOption('environment', 'e', InputOption::VALUE_REQUIRED, 'The environment name (e.g. production, staging)')
            ->addOption('format', 'f', InputOption::VALUE_REQUIRED, 'Output format (dotenv or shell)', 'dotenv')
            ->addOption('keys', 'k', InputOption::VALUE_REQUIRED, 'Comma-separated list of keys')
            ->addOption('redact', null, InputOption::VALUE_NEGATABLE, 'Redact secret values', true)
            ->addOption('sort', null, InputOption::VALUE_NEGATABLE, 'Sort by key name', true)
            ->addOption('newline', null, InputOption::VALUE_NEGATABLE, 'End output with a newline', true)
            ->addOption('print', 'p', InputOption::VALUE_REQUIRED, 'Print the value of a single key');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $env = $this->option('environment');
        if (! $env) {
            $this->writeError('ERR[5] Environment not specified.');

            return 5;
        }

        $format = strtolower((string) ($this->option('format') ?: 'dotenv'));
        if (! in_array($format, ['dotenv', 'shell'], true)) {
            $this->writeError('ERR[5] Unsupported format. Use "dotenv" or "shell".');

            return 5;
        }

        $keysOption = $this->option('keys');
        $keys = $keysOption ? array_values(array_filter(array_map('trim', explode(',', $keysOption)), fn ($k) => $k !== '')) : null;

        $redact = (bool) $this->option('redact');
        $sort = (bool) $this->option('sort');
        $newline = (bool) $this->option('newline');
        $print = $this->option('print');

        if (! $redact && ! $this->isInteractive()) {
            $this->writeError('ERR[3] --no-redact is only allowed on an interactive TTY.');

            return 3;
        }

        // --- Fetch JSON and build $vars ---
        try {
            // Expecting associative array like:
            // ['data' => [ ['key' => 'APP_DEBUG', 'value' => 'false', ...], ... ]]
            $payload = $this->ghostable->fetch(Manifest::id(), $env);
        } catch (\Throwable $e) {
            $this->writeError('ERR[5] Environment not found.');

            return 5;
        }

        $vars = [];
        foreach ($payload as $row) {
            // Skip commented or malformed entries gracefully
            if (! isset($row['key'])) {
                continue;
            }
            $k = (string) $row['key'];
            // If server may send null values, coerce to empty string
            $v = isset($row['value']) ? (string) $row['value'] : '';
            // Optional: honor is_commented flag
            if (isset($row['is_commented']) && (int) $row['is_commented'] === 1) {
                continue;
            }
            $vars[$k] = $v;
        }

        // Single-key print mode
        if ($print !== null) {
            if (! array_key_exists($print, $vars)) {
                $this->writeError('ERR[2] Missing required keys: '.$print);

                return 2;
            }
            $value = $redact ? 'REDACTED' : $vars[$print];
            $this->output->write($value);
            if ($newline) {
                $this->output->write("\n");
            }

            return Command::SUCCESS;
        }

        // Determine output order
        if ($keys) {
            $order = [];
            $missing = [];
            foreach ($keys as $key) {
                if (array_key_exists($key, $vars)) {
                    $order[] = $key;
                } else {
                    $missing[] = $key;
                }
            }
            if ($missing) {
                $this->writeError('ERR[2] Missing required keys: '.implode(', ', $missing));

                return 2;
            }
        } else {
            $order = array_keys($vars);
            if ($sort) {
                sort($order, SORT_NATURAL | SORT_FLAG_CASE);
            }
        }

        // Render
        $lines = [];
        foreach ($order as $key) {
            $value = $redact ? 'REDACTED' : $vars[$key];
            if ($format === 'shell') {
                $lines[] = 'export '.$key.'='.$this->escapeShellValue($value);
            } else {
                $lines[] = $key.'='.$this->escapeDotenvValue($value);
            }
        }

        $output = implode("\n", $lines);
        if ($newline) {
            $output .= "\n";
        }

        $this->output->write($output);

        return Command::SUCCESS;
    }

    protected function escapeDotenvValue(string $value): string
    {
        // Represent newlines safely in a single line
        $value = str_replace("\n", '\\n', $value);
        // Quote if contains whitespace, #, =, quotes, backslash, or non-printable
        $needsQuotes = preg_match('/\s|#|=|"|\\\\|[^\x20-\x7E]/', $value);
        if ($needsQuotes) {
            $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $value);

            return '"'.$escaped.'"';
        }

        return $value;
    }

    protected function escapeShellValue(string $value): string
    {
        $value = str_replace("\n", '\\n', $value);

        // POSIX: wrap in single quotes and escape existing ones via: '\'' trick
        return "'".str_replace("'", "'\\''", $value)."'";
    }

    protected function isInteractive(): bool
    {
        if (function_exists('stream_isatty')) {
            return @stream_isatty(STDOUT);
        }
        if (function_exists('posix_isatty')) {
            return @posix_isatty(STDOUT);
        }

        return false;
    }

    protected function writeError(string $message): void
    {
        if ($this->output instanceof ConsoleOutputInterface) {
            $this->output->getErrorOutput()->writeln($message);
        } else {
            $this->output->writeln($message);
        }
    }
}
