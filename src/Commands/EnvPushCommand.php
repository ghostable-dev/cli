<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputArgument;

use function Laravel\Prompts\confirm;
use function Laravel\Prompts\select;

class EnvPushCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:push')
            ->addOption('environment', null, InputArgument::OPTIONAL, 'The environment name')
            ->setDescription('Upload the environment file for the given environment within the current team context.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $envNames = Manifest::environmentNames();

        $option = $this->option('environment');

        $env = $option
            ? $this->resolveEnvFromOption($option, $envNames)
            : $this->promptForEnv($envNames);

        try {
            $lines = $this->env->getRaw($env);
        } catch (\Throwable $e) {
            Helpers::abort('The environment could not be loaded.');
        }

        Helpers::info("You're about to push the <comment>{$env}</comment> environment to Ghostable.");
        Helpers::warn('This will overwrite the existing environment configuration.'.PHP_EOL);
        if (! confirm('Are you sure you want to continue?')) {
            Helpers::warn('Cancelled. No changes were made.');

            return Command::SUCCESS;
        }

        try {
            ob_start();
            $response = $this->ghostable->push(Manifest::id(), $env, $lines);
            ob_end_clean();
        } catch (ClientException $e) {
            ob_end_clean();

            $response = $e->getResponse();

            if ($response->getStatusCode() === 422) {
                Helpers::danger('Push failed due to validation errors:');
                $data = json_decode((string) $response->getBody(), true);
                foreach (($data['errors'] ?? []) as $field => $messages) {
                    foreach ((array) $messages as $message) {
                        Helpers::line('  - '.$message);
                    }
                }
            } else {
                Helpers::danger('Push failed.');
            }

            return Command::FAILURE;
        }

        Helpers::info("✅ Environment <comment>{$env}</comment> pushed to Ghostable.");
        Helpers::info("{$response['message']}");

        if ($response['status'] === 'updated') {
            Helpers::info("✅ Environment <comment>{$env}</comment> pushed to Ghostable.");
            Helpers::line("• {$response['data']['added']} added");
            Helpers::line("• {$response['data']['updated']} updated");
            Helpers::line("• {$response['data']['removed']} removed");
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
            if (confirm('Would you like to create it?')) {
                // create environment (and push)
            }

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
            'Which env would you like to push?',
            collect($envs)->sort()->values()->toArray()
        );
    }
}
