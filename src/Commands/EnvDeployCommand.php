<?php

namespace Ghostable\Commands;

use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Process\Process;

class EnvDeployCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:deploy')
            ->setDescription('Resolve env vars from the API and apply them without writing files.')
            ->addOption('environment', 'e', InputOption::VALUE_REQUIRED, 'The environment name (e.g. production, staging)')
            ->addOption('target', null, InputOption::VALUE_REQUIRED, 'Deployment target', 'process')
            ->addOption('exec', null, InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, 'Commands to run under injected env')
            ->addOption('laravel', null, InputOption::VALUE_NONE, 'Run Laravel cache rebuild')
            ->addOption('plan', null, InputOption::VALUE_NONE, 'Show key names to be applied (no values) and exit')
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Do everything except actually run child processes')
            ->addOption('redact', null, InputOption::VALUE_NEGATABLE, 'Redact secret values in logs', true)
            ->addOption('no-restart-horizon', null, InputOption::VALUE_NONE, 'If --laravel, skip horizon:terminate');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $env = $this->option('environment');
        if (! $env) {
            $this->writeError('ERR[5] Environment not specified.');

            return 5;
        }

        $redact = (bool) $this->option('redact');
        if (! $redact && ! $this->isInteractive()) {
            $this->writeError('ERR[3] --no-redact is only allowed on an interactive TTY.');

            return 3;
        }

        try {
            $rows = $this->ghostable->deploy();
        } catch (ClientException $e) {
            if ($e->getResponse()->getStatusCode() === 422) {
                $this->writeError('ERR[5] Environment validation failed. Deployment aborted.');
            } else {
                $this->writeError('ERR[5] Environment not found.');
            }

            return 5;
        }

        $envMap = [];
        foreach ($rows as $row) {
            if (! isset($row['key'])) {
                continue;
            }
            if (isset($row['is_commented']) && (int) $row['is_commented'] === 1) {
                continue;
            }
            $k = (string) $row['key'];
            $v = isset($row['value']) ? (string) $row['value'] : '';
            $envMap[$k] = $v;
        }

        $keys = array_keys($envMap);
        sort($keys, SORT_NATURAL | SORT_FLAG_CASE);

        if ($this->option('plan') || $this->option('dry-run')) {
            $this->output->writeln(count($keys).' environment variables:');
            foreach ($keys as $k) {
                $this->output->writeln(' - '.$k);
            }

            return Command::SUCCESS;
        }

        $target = strtolower((string) ($this->option('target') ?: 'process'));
        if ($target !== 'process') {
            $this->writeError('ERR[5] Unsupported target.');

            return 5;
        }

        // Merge existing env with fetched values
        $childEnv = array_merge($_ENV, $_SERVER);
        foreach ($envMap as $k => $v) {
            $childEnv[$k] = $v;
        }

        $commands = [];

        if ($this->option('laravel')) {
            $commands[] = 'php artisan config:clear';
            $commands[] = 'php artisan config:cache';
            if (! $this->option('no-restart-horizon')) {
                $commands[] = ['cmd' => 'php artisan horizon:terminate', 'ignore' => true];
            }
        }

        foreach ((array) $this->option('exec') as $cmd) {
            $commands[] = $cmd;
        }

        foreach ($commands as $entry) {
            $cmd = is_array($entry) ? $entry['cmd'] : $entry;
            $ignore = is_array($entry) && ($entry['ignore'] ?? false);
            $exit = $this->runCmd($cmd, $childEnv, $envMap, $redact, $ignore);
            if ($exit !== 0) {
                return $exit;
            }
        }

        return Command::SUCCESS;
    }

    protected function runCmd(string $cmd, array $env, array $envMap, bool $redact, bool $ignoreFailure = false): int
    {
        $this->logEnv($cmd, $envMap, $redact);

        $shell = getenv('SHELL') ?: '/bin/bash';
        $process = new Process([$shell, '-lc', $cmd], null, $env);
        $process->setTty($this->isInteractive());
        $process->run(function ($type, $buffer) {
            $this->output->write($buffer);
        });

        $code = $process->getExitCode() ?? 0;
        if ($code !== 0 && ! $ignoreFailure) {
            return $code;
        }

        return 0;
    }

    protected function logEnv(string $cmd, array $envMap, bool $redact): void
    {
        $this->output->writeln('> '.$cmd);
        if ($redact) {
            $this->output->writeln('Env: '.implode(', ', array_keys($envMap)));
        } else {
            foreach ($envMap as $k => $v) {
                $this->output->writeln($k.'='.$v);
            }
        }
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
