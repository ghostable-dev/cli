<?php

namespace Ghostable\Commands;

use Ghostable\Env\Resolver;
use Ghostable\Helpers;
use GuzzleHttp\Client;
use Symfony\Component\Console\Input\InputOption;

class EnvForgeCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:forge')
            ->setDescription('Deploy environment variables to a Laravel Forge site.')
            ->addOption('environment', 'e', InputOption::VALUE_REQUIRED, 'The environment name (e.g. production, staging)')
            ->addOption('server', null, InputOption::VALUE_REQUIRED, 'Forge server ID')
            ->addOption('site', null, InputOption::VALUE_REQUIRED, 'Forge site ID')
            ->addOption('token', null, InputOption::VALUE_REQUIRED, 'Forge API token')
            ->addOption('deploy', null, InputOption::VALUE_NONE, 'Trigger a deployment after updating env');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $env = $this->option('environment');
        $server = $this->option('server');
        $site = $this->option('site');
        $token = $this->option('token') ?: getenv('FORGE_API_TOKEN');

        if (! $env || ! $server || ! $site || ! $token) {
            Helpers::danger('ERR[5] Missing required options.');

            return 5;
        }

        try {
            $envMap = Resolver::resolve($this->ghostable, (string) $env);
        } catch (\Throwable $e) {
            Helpers::danger('ERR[5] Environment not found.');

            return 5;
        }

        ksort($envMap, SORT_NATURAL | SORT_FLAG_CASE);

        $lines = [];
        foreach ($envMap as $k => $v) {
            $lines[] = $k.'='.$v;
        }
        $content = implode(PHP_EOL, $lines).PHP_EOL;

        $client = $this->makeForgeClient($token);

        $response = $client->put("servers/{$server}/sites/{$site}/env", [
            'form_params' => ['content' => $content],
        ]);

        if ($response->getStatusCode() >= 300) {
            Helpers::danger('ERR[5] Forge API error.');

            return 5;
        }

        Helpers::info('Forge environment updated.');

        if ($this->option('deploy')) {
            $response = $client->post("servers/{$server}/sites/{$site}/deploy");

            if ($response->getStatusCode() >= 300) {
                Helpers::danger('ERR[5] Forge deploy failed.');

                return 5;
            }

            Helpers::info('Forge deployment triggered.');
        }

        return Command::SUCCESS;
    }

    protected function makeForgeClient(string $token): Client
    {
        return new Client([
            'base_uri' => 'https://forge.laravel.com/api/v1/',
            'http_errors' => false,
            'headers' => [
                'Authorization' => 'Bearer '.$token,
                'Accept' => 'application/json',
            ],
        ]);
    }
}
