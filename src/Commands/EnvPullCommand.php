<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputArgument;

use function Laravel\Prompts\confirm;
use function Laravel\Prompts\select;

class EnvPullCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:pull')
            ->addOption('environment', null, InputArgument::OPTIONAL, 'The environment name')
            ->setDescription('Download the environment file for the given environment.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $project = Manifest::current();

        $option = $this->option('environment');

        $env = $option
            ? $this->resolveEnvFromOption($option, $project['environments'])
            : $this->promptForEnv($project['environments']);

        Helpers::info("You're about to pull the <comment>{$env}</comment> environment from Ghostable.");
        Helpers::warn('This will overwrite the existing environment file (if present).'.PHP_EOL);
        if (! confirm('Are you sure you want to continue?')) {
            Helpers::warn('Cancelled. No changes were made.');

            return Command::SUCCESS;
        }

        $file = $this->ghostable->pull(Manifest::id(), $env);

        $this->env->save($env, $file);

        Helpers::info("✅ Environment <comment>{$env}</comment> pulled to your local directory.");

        return Command::SUCCESS;
    }

    protected function resolveEnvFromOption(mixed $name, array $envs): ?string
    {
        if (! in_array($name, $envs)) {
            Helpers::warn("Environment <comment>{$name}</comment> not found.");

            return null;
        }

        return $name;
    }

    protected function promptForEnv(array $envs): string
    {
        return select(
            'Which env would you like to pull?',
            collect($envs)->sort()->values()->toArray()
        );
    }
}
