<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputOption;

use function Laravel\Prompts\select;
use function Laravel\Prompts\table;

class SecretListCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('secret:list')
            ->addOption('environment', null, InputOption::VALUE_OPTIONAL, 'The environment name')
            ->setDescription('List the secrets for the given environment within the current project context.');
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

        if (empty($secrets)) {
            Helpers::info('No secrets found in this environment');

            return Command::SUCCESS;
        }

        table(
            headers: ['ID', 'Name', 'Type'],
            rows: collect($secrets)->map(function ($secret) {
                return [
                    $secret['id'] ?? '',
                    $secret['name'] ?? '',
                    $secret['type'] ?? ($secret['secret_type'] ?? ''),
                ];
            })->values()->all()
        );

        return Command::SUCCESS;
    }
}
