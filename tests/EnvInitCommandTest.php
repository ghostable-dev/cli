<?php

namespace Ghostable\Tests;

use Ghostable\Application;
use Ghostable\Commands\EnvInitCommand;
use Ghostable\GhostableConsoleClient;
use Illuminate\Container\Container;
use Laravel\Prompts\Key;
use Laravel\Prompts\Prompt;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Yaml\Yaml;

class EnvInitCommandTest extends TestCase
{
    protected function command(): EnvInitCommand
    {
        $client = new class extends GhostableConsoleClient
        {
            public function envTypes(): array
            {
                return [
                    ['value' => 'laravel', 'label' => 'Laravel'],
                ];
            }

            public function createEnvironment(string $projectId, string $name, string $type): array
            {
                return [
                    'name' => $name,
                    'type' => $type,
                ];
            }
        };

        $command = new class($client) extends EnvInitCommand
        {
            public function __construct(GhostableConsoleClient $client)
            {
                parent::__construct();
                $this->ghostable = $client;
            }

            protected function ensureAccessTokenIsAvailable(): void
            {
                // Skip token check in tests
            }
        };

        $app = new Application;
        $app->add($command);

        return $app->find('env:init');
    }

    public function test_environment_is_added_with_type(): void
    {
        Container::setInstance(new Container);

        $manifest = tempnam(sys_get_temp_dir(), 'manifest').'.yml';
        file_put_contents($manifest, Yaml::dump([
            'id' => 'p1',
            'name' => 'Demo',
            'environments' => [
                ['name' => 'local', 'type' => 'laravel'],
            ],
        ]));

        Prompt::fake([
            Key::ENTER, // select first env type
            's', 't', 'a', 'g', 'i', 'n', 'g', Key::ENTER,
        ]);

        $tester = new CommandTester($this->command());

        $status = $tester->execute(['--manifest' => $manifest]);

        $this->assertSame(Command::SUCCESS, $status);

        $data = Yaml::parse(file_get_contents($manifest));

        $this->assertContains([
            'name' => 'staging',
            'type' => 'laravel',
        ], $data['environments']);
    }
}
