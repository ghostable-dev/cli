<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputOption;

class EnvDeployCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:deploy')
            ->addOption('validate', null, InputOption::VALUE_NONE, 'Validate the environment after pulling')
            ->setDescription('Fetch environment variables for deployment.');
    }

    public function handle(): ?int
    {
        $token = $this->config->getCiToken();

        if (! $token) {
            Helpers::danger('GHOSTABLE_CI_TOKEN environment variable is not set.');

            return Command::FAILURE;
        }

        $ghostable = $this->makeGhostableClient(token: $token);

        try {
            $contents = $ghostable->deploy();
        } catch (ClientException $e) {
            return Command::FAILURE;
        }

        if ($this->option('validate')) {
            try {
                ob_start();
                $response = $ghostable->validateEnvironment(
                    Manifest::id(),
                    'deploy',
                    preg_split("/\r?\n/", trim($contents)) ?: []
                );
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

            Helpers::info('✅ Environment is valid.');
            if (isset($response['message'])) {
                Helpers::info($response['message']);
            }
        }

        file_put_contents('.env', $contents);

        Helpers::info('✅ Environment variables successfully written to .env');

        return Command::SUCCESS;
    }
}
