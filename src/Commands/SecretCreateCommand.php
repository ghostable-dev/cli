<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputOption;

use function Laravel\Prompts\password;
use function Laravel\Prompts\select;

class SecretCreateCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('secret:create')
            ->addOption('environment', null, InputOption::VALUE_OPTIONAL, 'The environment name')
            ->addOption('type', null, InputOption::VALUE_OPTIONAL, 'The secret type')
            ->addOption('value', null, InputOption::VALUE_OPTIONAL, 'The secret value')
            ->setDescription('Create a new secret for the given environment.');
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

        $types = $this->ghostable->secretTypes();
        $secret = $this->option('type');

        if (! $secret) {
            $secret = select(
                label: 'Which secret type?',
                options: collect($types)->mapWithKeys(
                    fn ($t) => [($t['value'] ?? ($t['id'] ?? '')) => $t['label'] ?? ($t['name'] ?? '')]
                )->all(),
                scroll: 12
            );
        }

        $value = $this->option('value') ?? password('Enter the secret value');

        $this->ghostable->createEnvironmentSecret(Manifest::id(), $env, $secret, $value);

        Helpers::info('✅ Secret created successfully.');

        return Command::SUCCESS;
    }
}
