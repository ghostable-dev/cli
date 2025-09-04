<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;

use function Laravel\Prompts\password;
use function Laravel\Prompts\select;

class SecretUpdateCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('secret:update')
            ->addOption('environment', null, InputOption::VALUE_OPTIONAL, 'The environment name')
            ->addArgument('secret', InputArgument::OPTIONAL, 'The secret identifier')
            ->addOption('value', null, InputOption::VALUE_OPTIONAL, 'The new secret value')
            ->setDescription('Update an existing secret for the given environment.');
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
                label: 'Which secret would you like to update?',
                options: collect($secrets)->mapWithKeys(
                    fn ($s) => [$s['id'] => $s['name'] ?? $s['id']]
                )->all(),
                scroll: 12
            );
        }

        $value = $this->option('value') ?? password('Enter the new secret value');

        $this->ghostable->updateEnvironmentSecret(Manifest::id(), $env, $secret, $value);

        Helpers::info('✅ Secret updated successfully.');

        return Command::SUCCESS;
    }
}
