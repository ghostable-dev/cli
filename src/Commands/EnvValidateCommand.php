<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputArgument;

use function Laravel\Prompts\select;

class EnvValidateCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:validate')
            ->addOption('environment', null, InputArgument::OPTIONAL, 'The environment name')
            ->setDescription('Validate the environment file for the given environment.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $envNames = Manifest::environmentNames();

        $option = $this->option('environment');

        $env = $option
            ? $this->resolveEnvFromOption($option, $envNames)
            : $this->promptForEnv($envNames);

        if (! $env) {
            return Command::FAILURE;
        }

        try {
            $lines = $this->env->getRaw($env);
        } catch (\Throwable $e) {
            Helpers::abort('The environment could not be loaded.');
        }

        try {
            ob_start();
            $response = $this->ghostable->validateEnvironment(Manifest::id(), $env, $lines);
            ob_end_clean();
        } catch (ClientException $e) {
            ob_end_clean();

            $response = $e->getResponse();

            if ($response->getStatusCode() === 422) {
                Helpers::danger('Validation failed due to errors:');
                $data = json_decode((string) $response->getBody(), true);
                foreach (($data['errors'] ?? []) as $field => $messages) {
                    foreach ((array) $messages as $message) {
                        Helpers::line('  - '.$message);
                    }
                }
            } else {
                Helpers::danger('Validation failed.');
            }

            return Command::FAILURE;
        }

        Helpers::info("✅ Environment <comment>{$env}</comment> is valid.");
        if (isset($response['message'])) {
            Helpers::info($response['message']);
        }

        return Command::SUCCESS;
    }

    /**
     * @param  string[]  $envs
     */
    protected function resolveEnvFromOption(mixed $name, array $envs): ?string
    {
        if (! in_array($name, $envs)) {
            Helpers::warn("Environment <comment>{$name}</comment> not found.");

            return null;
        }

        return $name;
    }

    /**
     * @param  string[]  $envs
     */
    protected function promptForEnv(array $envs): string
    {
        return select(
            'Which env would you like to validate?',
            collect($envs)->sort()->values()->toArray()
        );
    }
}
