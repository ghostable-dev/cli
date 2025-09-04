<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;

use function Laravel\Prompts\confirm;
use function Laravel\Prompts\select;
use function Laravel\Prompts\text;

class SecretWriteCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('secret:write')
            ->addOption('environment', null, InputOption::VALUE_OPTIONAL, 'The environment name')
            ->addArgument('secret', InputArgument::OPTIONAL, 'The secret identifier')
            ->addOption('path', null, InputOption::VALUE_OPTIONAL, 'Relative file path to write (within CWD)')
            ->addOption('mode', null, InputOption::VALUE_OPTIONAL, 'File permissions (e.g. 600 or 0600)')
            ->addOption('force', null, InputOption::VALUE_NONE, 'Overwrite the file without confirmation')
            ->setDescription("Write a secret's value to a file under the current directory (safe & atomic).");
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $envNames = Manifest::environmentNames();
        $env = $this->option('environment');

        if (! $env) {
            $env = select('Which env would you like to use?', $envNames);
        } elseif (! in_array($env, $envNames, true)) {
            Helpers::warn("Environment <comment>{$env}</comment> not found.");

            return Command::FAILURE;
        }

        $secrets = $this->ghostable->environmentSecrets(Manifest::id(), $env);

        if (count($secrets) === 0) {
            Helpers::abort(
                'No secrets found for this project.'.PHP_EOL.
                'Then run: ghostable secret:create'
            );
        }

        $secret = $this->argument('secret') ?: select(
            label: 'Which secret would you like to write?',
            options: collect($secrets)->mapWithKeys(fn ($s) => [$s['id'] => $s['name'] ?? $s['id']])->all(),
            scroll: 12
        );

        $inputPath = $this->option('path') ?? text('Enter relative file path (under current directory)');
        [$path, $dir] = $this->resolveRelativePathOrFail($inputPath, getcwd());

        // Always create parent directories (0700)
        if (! is_dir($dir)) {
            if (! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
                Helpers::warn("Failed to create directory <comment>{$dir}</comment>. Check permissions.");

                return Command::FAILURE;
            }
        }

        // Overwrite policy
        if (file_exists($path) && ! $this->option('force')) {
            if (! confirm('File exists. Overwrite?')) {
                Helpers::warn('Cancelled. No changes were made.');

                return Command::SUCCESS;
            }
        }

        // Fetch secret
        $data = $this->ghostable->environmentSecret(Manifest::id(), $env, $secret);
        $value = $data['value'] ?? null;
        if ($value === null) {
            Helpers::warn('Secret value not found.');

            return Command::FAILURE;
        }

        // Atomic write with safe umask
        $oldUmask = umask(0177); // default to 0600
        try {
            $tmp = $this->tempPath($dir);
            if (@file_put_contents($tmp, $value) === false) {
                @unlink($tmp);
                Helpers::warn("Failed to write temporary file in <comment>{$dir}</comment>. Check permissions/space.");

                return Command::FAILURE;
            }

            // Set mode before rename; parse & bound mode
            $mode = $this->parseMode($this->option('mode')); // default 0600
            @chmod($tmp, $mode);

            if (! @rename($tmp, $path)) {
                @unlink($tmp);
                Helpers::warn("Failed to move file into place at <comment>{$path}</comment>. Check permissions.");

                return Command::FAILURE;
            }
        } finally {
            umask($oldUmask);
        }

        Helpers::info('✅ Secret written to <comment>'.$path.'</comment>.');

        return Command::SUCCESS;
    }

    /**
     * Enforce a relative path under $base (CWD), reject absolute, ~, and escaping.
     */
    private function resolveRelativePathOrFail(string $input, string $base): array
    {
        $p = trim($input);

        if ($p === '' || $p === '.' || $p === './') {
            Helpers::abort('Please provide a file path relative to the current directory.');
        }

        // Hard rejects
        if (str_starts_with($p, '~')) {
            Helpers::abort('Tilde expansion is not allowed. Use a relative path under the current directory.');
        }
        if ($this->isAbsolutePath($p)) {
            Helpers::abort('Absolute paths are not allowed. Provide a relative path under the current directory.');
        }
        if (strpbrk($p, "\0") !== false || preg_match('/[\x00-\x1F\x7F]/', $p)) {
            Helpers::abort('Invalid path: contains control characters.');
        }

        // Canonicalize and confine
        $full = $this->canonicalize(rtrim($base, DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.$p);
        if (! $this->pathIsWithin($full, $base)) {
            Helpers::abort('Refusing to write outside the current directory.');
        }

        return [$full, dirname($full)];
    }

    private function isAbsolutePath(string $p): bool
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            return (bool) preg_match('#^(?:[a-zA-Z]:\\\\|\\\\\\\\)#', $p);
        }

        return str_starts_with($p, '/');
    }

    private function canonicalize(string $p): string
    {
        $sep = DIRECTORY_SEPARATOR;
        $p = str_replace(['/', '\\'], $sep, $p);

        $parts = array_values(array_filter(explode($sep, $p), fn ($s) => $s !== ''));
        $stack = [];
        foreach ($parts as $part) {
            if ($part === '.') {
                continue;
            }
            if ($part === '..') {
                if (! empty($stack)) {
                    array_pop($stack);
                }

                continue;
            }
            $stack[] = $part;
        }
        $prefix = $this->isAbsolutePath($p) ? $sep : '';

        return $prefix.implode($sep, $stack);
    }

    private function pathIsWithin(string $path, string $base): bool
    {
        $sep = DIRECTORY_SEPARATOR;
        $path = rtrim($this->canonicalize($path), $sep).$sep;
        $base = rtrim($this->canonicalize($base), $sep).$sep;

        return str_starts_with($path, $base);
    }

    private function parseMode(?string $mode): int
    {
        if ($mode === null || $mode === '') {
            return 0600;
        }

        if (ctype_digit($mode)) {
            $oct = octdec($mode);
            if (($oct & 0o137) !== 0) { // any group write/exec or any other perms
                Helpers::warn("Unsafe mode {$mode}; clamping to 0640.");

                return 0640;
            }

            return $oct;
        }

        if (str_starts_with($mode, '0o')) {
            return $this->parseMode(substr($mode, 2));
        }

        Helpers::warn("Invalid mode <comment>{$mode}</comment>; defaulting to 0600.");

        return 0600;
    }

    private function tempPath(string $dir): string
    {
        $tmp = @tempnam($dir, '.ghostable.');
        if ($tmp === false) {
            Helpers::abort("Unable to create temporary file in <comment>{$dir}</comment>.");
        }

        return $tmp;
    }
}
