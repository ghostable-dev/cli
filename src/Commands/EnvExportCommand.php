<?php

namespace Ghostable\Commands;

use Dotenv\Parser\Parser;
use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\ConsoleOutputInterface;

class EnvExportCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:export')
            ->addOption('environment', 'e', InputArgument::OPTIONAL, 'The environment name')
            ->addOption('format', 'f', InputArgument::OPTIONAL, 'Output format (dotenv or shell)', 'dotenv')
            ->addOption('keys', 'k', InputArgument::OPTIONAL, 'Comma-separated list of keys')
            ->addOption('redact', null, InputOption::VALUE_NEGATABLE, 'Redact secret values', true)
            ->addOption('sort', null, InputOption::VALUE_NEGATABLE, 'Sort by key name', true)
            ->addOption('newline', null, InputOption::VALUE_NEGATABLE, 'End output with a newline', true)
            ->addOption('print', null, InputArgument::OPTIONAL, 'Print the value of a single key')
            ->setDescription('Print resolved environment variables');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $env = $this->option('environment');
        if (! $env) {
            $this->writeError('ERR[5] Environment not specified.');

            return 5;
        }

        $format = $this->option('format') ?: 'dotenv';
        $keysOption = $this->option('keys');
        $keys = $keysOption ? array_map('trim', explode(',', $keysOption)) : null;
        $redact = (bool) $this->option('redact');
        $sort = (bool) $this->option('sort');
        $newline = (bool) $this->option('newline');
        $print = $this->option('print');

        if (! $redact && ! $this->isInteractive()) {
            $this->writeError('ERR[3] --no-redact is only allowed on an interactive TTY.');

            return 3;
        }

        try {
            $contents = $this->ghostable->pull(Manifest::id(), $env, 'dotenv');
        } catch (\Throwable $e) {
            $this->writeError('ERR[5] Environment not found.');

            return 5;
        }

        $parser = new Parser;
        $vars = [];
        foreach (preg_split("/\r?\n/", trim($contents)) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            try {
                $parsed = $parser->parse($line);
            } catch (\Throwable $e) {
                continue;
            }

            foreach ($parsed as $entry) {
                $vars[$entry->getName()] = $entry->getValue()->get()->getChars();
            }
        }

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
                sort($order, SORT_STRING);
            }
        }

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
        $value = str_replace("\n", '\\n', $value);
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
        $value = str_replace("'", "'\\''", $value);

        return "'{$value}'";
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
