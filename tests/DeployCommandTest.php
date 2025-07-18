<?php

namespace Ghostable\Tests;

use Ghostable\Application;
use Ghostable\Commands\DeployCommand;
use Ghostable\GhostableConsoleClient;
use Illuminate\Container\Container;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Yaml\Yaml;

class DeployCommandTest extends TestCase
{
    protected function command(GhostableConsoleClient $client): DeployCommand
    {
        $command = new class($client) extends DeployCommand
        {
            public function __construct(private GhostableConsoleClient $client)
            {
                parent::__construct();
            }

            protected function createClient(string $token): GhostableConsoleClient
            {
                return $this->client;
            }
        };

        $app = new Application;
        $app->add($command);

        return $app->find('deploy');
    }

    protected function makeManifest(): string
    {
        $manifest = tempnam(sys_get_temp_dir(), 'manifest').'.yml';
        file_put_contents($manifest, Yaml::dump([
            'id' => 'p1',
            'name' => 'Demo',
            'environments' => [
                ['name' => 'prod', 'type' => 'production'],
            ],
        ]));

        return $manifest;
    }

    public function test_fails_when_token_missing(): void
    {
        Container::setInstance(new Container);

        $manifest = $this->makeManifest();

        putenv('GHOSTABLE_CI_TOKEN');

        $client = new class extends GhostableConsoleClient
        {
            public function pull(string $projectId, string $name): string
            {
                return '';
            }
        };

        $tester = new CommandTester($this->command($client));

        $status = $tester->execute(['environment' => 'prod', '--manifest' => $manifest]);

        $this->assertSame(Command::FAILURE, $status);
        $this->assertStringContainsString('GHOSTABLE_CI_TOKEN environment variable is not set', $tester->getDisplay());
    }

    public function test_fetches_and_writes_environment(): void
    {
        Container::setInstance(new Container);

        $manifest = $this->makeManifest();

        putenv('GHOSTABLE_CI_TOKEN=abc');

        $client = new class extends GhostableConsoleClient
        {
            public function pull(string $projectId, string $name): string
            {
                return "FOO=bar\n";
            }

            public function validateEnvironment(string $projectId, string $name): array
            {
                return ['valid' => true];
            }
        };

        $output = tempnam(sys_get_temp_dir(), 'env');

        $tester = new CommandTester($this->command($client));

        $status = $tester->execute([
            'environment' => 'prod',
            '--manifest' => $manifest,
            '--output' => $output,
        ]);

        $this->assertSame(Command::SUCCESS, $status);
        $this->assertSame("FOO=bar\n", file_get_contents($output));
    }

    public function test_validation_failure_outputs_errors(): void
    {
        Container::setInstance(new Container);

        $manifest = $this->makeManifest();

        putenv('GHOSTABLE_CI_TOKEN=tok');

        $client = new class extends GhostableConsoleClient
        {
            public function pull(string $projectId, string $name): string
            {
                return "FOO=bar\n";
            }

            public function validateEnvironment(string $projectId, string $name): array
            {
                return ['valid' => false, 'errors' => ['bad']];
            }
        };

        $tester = new CommandTester($this->command($client));

        $status = $tester->execute([
            'environment' => 'prod',
            '--manifest' => $manifest,
            '--validate' => true,
        ]);

        $this->assertSame(Command::FAILURE, $status);
        $output = $tester->getDisplay();
        $this->assertStringContainsString('Environment validation failed', $output);
        $this->assertStringContainsString('  - bad', $output);
    }
}
