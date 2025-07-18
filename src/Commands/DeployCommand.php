<?php

namespace Ghostable\Commands;

use Ghostable\GhostableConsoleClient;
use Ghostable\Helpers;
use Ghostable\Manifest;
use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;

class DeployCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('deploy')
            ->addArgument('environment', InputArgument::REQUIRED, 'The environment to deploy')
            ->addOption('output', null, InputOption::VALUE_OPTIONAL, 'Where to write the env file', '.env')
            ->addOption('validate', null, InputOption::VALUE_NONE, 'Validate the environment after pulling')
            ->setDescription('Fetch environment variables for deployment.');
    }

    public function handle(): ?int
    {
        $token = getenv('GHOSTABLE_CI_TOKEN');

        if (! $token) {
            Helpers::danger('GHOSTABLE_CI_TOKEN environment variable is not set.');

            return Command::FAILURE;
        }

        $this->ghostable = $this->createClient($token);

        $projectId = Manifest::id();
        $env = $this->argument('environment');

        try {
            $contents = $this->ghostable->pull($projectId, $env);
        } catch (ClientException $e) {
            return Command::FAILURE;
        }

        if ($this->option('validate')) {
            try {
                $result = $this->ghostable->validateEnvironment($projectId, $env);
            } catch (ClientException $e) {
                return Command::FAILURE;
            }

            if (($result['valid'] ?? true) === false) {
                Helpers::danger('Environment validation failed:');
                foreach ((array) ($result['errors'] ?? []) as $message) {
                    Helpers::line('  - '.$message);
                }

                return Command::FAILURE;
            }
        }

        $output = $this->option('output') ?? '.env';

        file_put_contents($output, $contents);

        Helpers::info("✅ Environment <comment>{$env}</comment> written to {$output}.");

        return Command::SUCCESS;
    }

    protected function createClient(string $token): GhostableConsoleClient
    {
        return new class($token) extends GhostableConsoleClient
        {
            public function __construct(private string $token)
            {
                parent::__construct();
            }

            protected function authorizationHeader(): string
            {
                return 'Bearer '.$this->token;
            }
        };
    }
}
