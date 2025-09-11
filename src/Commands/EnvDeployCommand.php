<?php

namespace Ghostable\Commands;

use Ghostable\Contracts\EnvBuilder;
use Ghostable\Contracts\EnvVarExtractor;
use Ghostable\Helpers;
use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputOption;

class EnvDeployCommand extends Command
{
    protected EnvVarExtractor $extractor;

    protected EnvBuilder $builder;

    public function __construct()
    {
        $this->extractor = Helpers::app(EnvVarExtractor::class);

        $this->builder = Helpers::app(EnvBuilder::class);

        parent::__construct();
    }

    protected function configure(): void
    {
        $this->setName('env:deploy')
            ->setDescription('Resolve env vars from the API and apply them without writing files.')
            ->addOption('token', null, InputOption::VALUE_OPTIONAL, 'Ghostable CLI token')
            ->addOption('plan', null, InputOption::VALUE_NONE, 'Show key names to be applied (no values) and exit');
    }

    public function handle(): ?int
    {
        $token = $this->option('token') ?? $this->config->getCiToken();

        if (! $token) {
            $this->writeLine('GHOSTABLE_CI_TOKEN environment variable is not set.');

            return Command::FAILURE;
        }

        try {
            $vars = $this->getVarsUsingToken($token);
        } catch (ClientException $e) {
            return Command::FAILURE;
        }

        if ($this->option('plan')) {
            $this->printPlan($vars);

            return Command::SUCCESS;
        }

        try {
            $this->builder->build($vars, true);
        } catch (ClientException $e) {
            return Command::FAILURE;
        }

        return Command::SUCCESS;
    }

    protected function getVarsUsingToken(string $token): array
    {
        $ghostable = $this->makeGhostableClient(token: $token);

        $payload = $ghostable->deploy();

        return $this->extractor->extract($payload);
    }

    protected function printPlan(array $vars): void
    {
        $keys = array_keys($vars);

        sort($keys, SORT_NATURAL | SORT_FLAG_CASE);

        $this->writeLine(count($keys).' environment variables:');

        foreach ($keys as $k) {
            $this->writeLine(' - '.$k);
        }
    }
}
