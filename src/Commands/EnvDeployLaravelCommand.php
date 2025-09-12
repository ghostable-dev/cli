<?php

namespace Ghostable\Commands;

use Ghostable\Contracts\EnvRenderer;
use Ghostable\Helpers;
use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputOption;

class EnvDeployLaravelCommand extends EnvDeployCommand
{
    protected EnvRenderer $renderer;

    public function __construct()
    {
        $this->renderer = Helpers::app(EnvRenderer::class);

        parent::__construct();
    }

    protected function configure(): void
    {
        parent::configure();

        $this->setName('env:deploy-laravel')
            ->setDescription('Resolve env vars from the API and merge them into the .env file for Laravel deployments.')
            ->addOption('provider', null, InputOption::VALUE_REQUIRED, 'Deployment provider', 'cloud');
    }

    public function handle(): ?int
    {
        $provider = $this->option('provider');
        if ($provider !== 'cloud') {
            $this->writeLine('Unsupported provider. Only "cloud" is currently supported.');

            return Command::FAILURE;
        }

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

        $this->mergeIntoEnvFile($vars);

        return Command::SUCCESS;
    }

    /**
     * @param  array<string,string|null>  $vars
     */
    protected function mergeIntoEnvFile(array $vars): void
    {
        try {
            $lines = $this->env->getRaw('local');
        } catch (\Throwable $e) {
            $lines = [];
        }

        $indices = [];
        foreach ($lines as $i => $line) {
            if (preg_match('/^\s*([A-Za-z0-9_]+)\s*=/', $line, $m)) {
                $indices[$m[1]] = $i;
            }
        }

        foreach ($vars as $key => $value) {
            $escaped = $this->renderer->renderSingle([$key => $value], $key, 'dotenv', false, false);
            $newLine = $key.'='.$escaped;

            if (array_key_exists($key, $indices)) {
                $lines[$indices[$key]] = $newLine;
            } else {
                $lines[] = $newLine;
            }
        }

        $contents = implode(PHP_EOL, $lines).PHP_EOL;
        $this->env->save('local', $contents);
    }
}
