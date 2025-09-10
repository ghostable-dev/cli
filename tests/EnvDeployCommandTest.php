<?php

namespace Ghostable\Tests;

use Ghostable\Commands\EnvDeployCommand;
use Ghostable\Config;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Yaml\Yaml;

class EnvDeployCommandTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $_SERVER['HOME'] = sys_get_temp_dir();
        Config::setAccessToken('token');
    }

    private function makeManifest(): string
    {
        $data = [
            'id' => '1',
            'name' => 'Test',
            'environments' => [
                'production' => ['type' => 'production'],
            ],
        ];
        $path = tempnam(sys_get_temp_dir(), 'manifest');
        file_put_contents($path, Yaml::dump($data));

        return $path;
    }

    private function makeCommand(array $map, bool $interactive = false): EnvDeployCommand
    {
        $client = new class($map) extends \Ghostable\GhostableConsoleClient
        {
            public function __construct(private array $map) {}

            public function fetch(string $projectId, string $env): string
            {
                $data = [];
                foreach ($this->map as $k => $v) {
                    $row = ['key' => $k, 'value' => $v];
                    $data[] = $row;
                }

                return json_encode(['data' => $data]);
            }
        };

        return new class($client, $interactive) extends EnvDeployCommand
        {
            public function __construct(private $fakeClient, private bool $interactive)
            {
                parent::__construct();
                $this->ghostable = $fakeClient;
                $this->getDefinition()->addOption(new InputOption('manifest'));
                $this->getDefinition()->addOption(new InputOption('api-version'));
                $this->getDefinition()->addOption(new InputOption('debug'));
            }

            protected function isInteractive(): bool
            {
                return $this->interactive;
            }
        };
    }

    public function test_plan_outputs_sorted_keys(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand(['B' => '2', 'A' => '1']);
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
            '--plan' => true,
        ]);
        $this->assertSame(0, $exit);
        $display = $tester->getDisplay();
        $this->assertStringContainsString('2 environment variables:', $display);
        $this->assertTrue(strpos($display, ' - A') < strpos($display, ' - B'));
    }

    public function test_exec_receives_env(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand(['FOO' => 'bar']);
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
            '--exec' => ['php -r "echo getenv(\'FOO\');"'],
        ]);
        $this->assertSame(0, $exit);
        $this->assertStringContainsString('bar', $tester->getDisplay());
    }

    public function test_no_redact_without_tty_fails(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand(['A' => '1']);
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
            '--no-redact' => true,
        ]);
        $this->assertSame(3, $exit);
        $this->assertStringContainsString('--no-redact is only allowed', $tester->getDisplay());
    }
}
