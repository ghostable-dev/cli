<?php

namespace Ghostable\Tests;

use Ghostable\Commands\EnvExportCommand;
use Ghostable\Config;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Yaml\Yaml;

class EnvExportCommandTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $_SERVER['HOME'] = sys_get_temp_dir();
        Config::setAccessToken('token');
    }

    private function makeManifest(array $envs = ['production']): string
    {
        $data = [
            'id' => '1',
            'name' => 'Test',
            'environments' => [],
        ];
        foreach ($envs as $env) {
            $data['environments'][$env] = ['type' => $env];
        }
        $path = tempnam(sys_get_temp_dir(), 'manifest');
        file_put_contents($path, Yaml::dump($data));

        return $path;
    }

    private function makeCommand(string $contents, bool $interactive = false): EnvExportCommand
    {
        $client = new class($contents) extends \Ghostable\GhostableConsoleClient
        {
            public function __construct(private string $contents) {}

            public function fetch(string $projectId, string $env): string
            {
                $lines = array_filter(explode("\n", trim($this->contents)));
                $data = [];
                foreach ($lines as $line) {
                    if (! str_contains($line, '=')) {
                        continue;
                    }
                    [$key, $value] = explode('=', $line, 2);
                    $value = trim($value);
                    if ((str_starts_with($value, '"') && str_ends_with($value, '"')) ||
                        (str_starts_with($value, "'") && str_ends_with($value, "'"))) {
                        $value = substr($value, 1, -1);
                    }
                    $data[] = ['key' => $key, 'value' => $value];
                }

                return json_encode(['data' => $data]);
            }
        };

        return new class($client, $interactive) extends EnvExportCommand
        {
            public function __construct(private $fakeClient, private bool $interactive)
            {
                parent::__construct();
                $this->ghostable = $fakeClient;
                $this->getDefinition()->addOption(new \Symfony\Component\Console\Input\InputOption('manifest'));
                $this->getDefinition()->addOption(new \Symfony\Component\Console\Input\InputOption('api-version'));
                $this->getDefinition()->addOption(new \Symfony\Component\Console\Input\InputOption('debug'));
            }

            protected function isInteractive(): bool
            {
                return $this->interactive;
            }
        };
    }

    public function test_default_redacted_dotenv_sorted(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand("DB_HOST=localhost\nAPP_ENV=production\n");
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
        ]);

        $this->assertSame(0, $exit);
        $this->assertSame("APP_ENV=REDACTED\nDB_HOST=REDACTED\n", $tester->getDisplay());
    }

    public function test_shell_format_with_escaping_no_redact(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand("SPECIAL=\"a value with 'quotes'\"\n", true);
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
            '--format' => 'shell',
            '--no-redact' => true,
        ]);

        $this->assertSame(0, $exit);
        $this->assertSame("export SPECIAL='a value with '\''quotes'\'''\n", $tester->getDisplay());
    }

    public function test_keys_subset_respects_order(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand("A=1\nB=2\nC=3\n");
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
            '--keys' => 'B,A',
        ]);
        $this->assertSame(0, $exit);
        $this->assertSame("B=REDACTED\nA=REDACTED\n", $tester->getDisplay());
    }

    public function test_no_redact_without_tty_fails(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand("A=1\n");
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
            '--no-redact' => true,
        ]);

        $this->assertSame(3, $exit);
        $this->assertStringContainsString('--no-redact is only allowed', $tester->getDisplay());
    }

    public function test_print_single_key(): void
    {
        $manifest = $this->makeManifest();
        $command = $this->makeCommand("SECRET=s3cr3t\nOTHER=x\n");
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--manifest' => $manifest,
            '--print' => 'SECRET',
        ]);
        $this->assertSame(0, $exit);
        $this->assertSame("REDACTED\n", $tester->getDisplay());
    }
}
