<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
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

        }

        file_put_contents('.env', $contents);

        Helpers::info('✅ Environment variables successfully written to .env');

        return Command::SUCCESS;
    }
}
