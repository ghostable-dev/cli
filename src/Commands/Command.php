<?php

namespace Ghostable\Commands;

use DateTime;
use Exception;
use Ghostable\Config;
use Ghostable\Env\Env;
use Ghostable\GhostableConsoleClient;
use Ghostable\Helpers;
use Ghostable\Manifest;
use Symfony\Component\Console\Command\Command as SymfonyCommand;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

abstract class Command extends SymfonyCommand
{
    protected InputInterface $input;

    protected OutputInterface $output;

    protected DateTime $startedAt;

    protected GhostableConsoleClient $ghostable;

    protected Config $config;

    protected Env $env;

    public function __construct()
    {
        parent::__construct();

        $this->ghostable = new GhostableConsoleClient;
        $this->env = new Env;
        $this->config = new Config;
    }

    protected function execute(
        InputInterface $input,
        OutputInterface $output
    ): int {
        $this->startedAt = new DateTime;

        Helpers::app()->instance('input', $this->input = $input);
        Helpers::app()->instance('output', $this->output = $output);

        $this->configureManifestPath($input);

        return (int) ($this->handle() ?? 0);
    }

    /**
     * Configure the manifest location.
     */
    protected function configureManifestPath(InputInterface $input): void
    {
        $manifest = $input->getOption('manifest') ?? Manifest::defaultPath();

        Helpers::app()->offsetSet('manifest', $manifest);
    }

    abstract protected function handle(): ?int;

    protected function argument(string $key): mixed
    {
        return $this->input->getArgument($key);
    }

    protected function option(string $key): mixed
    {
        return $this->input->getOption($key);
    }

    protected function ensureAccessTokenIsAvailable(): void
    {
        if ($this->config->getAccessToken()) {
            return;
        }

        throw new Exception("Please authenticate using the 'login' command before proceeding.");
    }
}
