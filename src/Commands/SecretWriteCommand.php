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
            ->addOption('path', null, InputOption::VALUE_OPTIONAL, 'The file path to write the secret to')
            ->addOption('mode', null, InputOption::VALUE_OPTIONAL, 'The file permissions')
            ->addOption('mkdir', null, InputOption::VALUE_NONE, 'Create parent directories if missing')
            ->addOption('force', null, InputOption::VALUE_NONE, 'Overwrite the file without confirmation')
            ->setDescription("Write a secret's value to a file on disk.");
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $envNames = Manifest::environmentNames();
        $env = $this->option('environment');

        if (! $env) {
            $env = select('Which env would you like to use?', $envNames);
        } elseif (! in_array($env, $envNames)) {
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

        $secret = $this->argument('secret');

        if (! $secret) {
            $secret = select(
                label: 'Which secret would you like to write?',
                options: collect($secrets)->mapWithKeys(
                    fn ($s) => [$s['id'] => $s['name'] ?? $s['id']]
                )->all(),
                scroll: 12
            );
        }

        $path = $this->option('path') ?? text('Enter the file path');
        $mode = $this->option('mode');
        $mkdir = $this->option('mkdir');
        $force = $this->option('force');

        $dir = dirname($path);
        if (! is_dir($dir)) {
            if ($mkdir) {
                mkdir($dir, 0777, true);
            } else {
                Helpers::warn("Directory <comment>{$dir}</comment> does not exist.");

                return Command::FAILURE;
            }
        }

        if (file_exists($path) && ! $force) {
            if (! confirm('File exists. Overwrite?')) {
                Helpers::warn('Cancelled. No changes were made.');

                return Command::SUCCESS;
            }
        }

        $data = $this->ghostable->environmentSecret(Manifest::id(), $env, $secret);
        $value = $data['value'] ?? null;

        if ($value === null) {
            Helpers::warn('Secret value not found.');

            return Command::FAILURE;
        }

        file_put_contents($path, $value);

        if ($mode) {
            @chmod($path, octdec($mode));
        }

        Helpers::info('✅ Secret written successfully.');

        return Command::SUCCESS;
    }
}
