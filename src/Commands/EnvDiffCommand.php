<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputArgument;

use function Laravel\Prompts\select;

class EnvDiffCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:diff')
            ->addOption('environment', null, InputArgument::OPTIONAL, 'The environment name')
            ->setDescription('Show differences between the local environment file and Ghostable.');
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
            $response = $this->ghostable->diffEnvironment(Manifest::id(), $env, $lines);
            ob_end_clean();
        } catch (ClientException $e) {
            ob_end_clean();
            Helpers::danger('Diff failed.');

            return Command::FAILURE;
        }

        $data = $response['data'] ?? $response;

        $added = $data['added'] ?? [];
        $updated = $data['updated'] ?? [];
        $removed = $data['removed'] ?? [];

        if (empty($added) && empty($updated) && empty($removed)) {
            Helpers::info('No differences detected.');

            return Command::SUCCESS;
        }

        if ($added) {
            Helpers::info('Added variables:');
            foreach ($added as $key => $var) {
                $comment = ! empty($var['commented']) ? ' (commented)' : '';
                Helpers::line("  + {$key}={$var['value']}{$comment}");
            }
        }

        if ($updated) {
            Helpers::info('Updated variables:');
            foreach ($updated as $key => $var) {
                $current = $var['current'] ?? [];
                $incoming = $var['incoming'] ?? [];
                $commentChanged = (bool) ($current['commented'] ?? false) !== (bool) ($incoming['commented'] ?? false);
                $commentNote = $commentChanged ? ' (commented state changed)' : '';
                Helpers::line(
                    sprintf(
                        '  ~ %s: %s -> %s%s',
                        $key,
                        $current['value'] ?? '',
                        $incoming['value'] ?? '',
                        $commentNote
                    )
                );
            }
        }

        if ($removed) {
            Helpers::info('Removed variables:');
            foreach ($removed as $key => $var) {
                $comment = ! empty($var['commented']) ? ' (commented)' : '';
                Helpers::line("  - {$key}={$var['value']}{$comment}");
            }
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
            'Which env would you like to diff?',
            collect($envs)->sort()->values()->toArray()
        );
    }
}
