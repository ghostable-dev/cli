<?php

namespace Ghostable\Tests;

use Ghostable\Application;
use Ghostable\Commands\EnvPushCommand;
use Ghostable\Env\Env;
use Ghostable\GhostableConsoleClient;
use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Illuminate\Container\Container;
use Laravel\Prompts\Key;
use Laravel\Prompts\Prompt;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Yaml\Yaml;

class EnvPushCommandTest extends TestCase
{
    protected function failingClient(): GhostableConsoleClient
    {
        $response = new Response(422, [], json_encode(['errors' => ['APP_KEY' => ['bad']]]));
        $exception = new ClientException('invalid', new Request('POST', '/push'), $response);

        return new class($exception) extends GhostableConsoleClient
        {
            public function __construct(private ClientException $exception)
            {
                parent::__construct();
            }

            public function push(string $projectId, string $name, array $vars): array
            {
                $this->handleRequestError($this->exception);
                throw $this->exception;
            }
        };
    }

    protected function stubEnv(): Env
    {
        return new class extends Env
        {
            public function __construct()
            {
                parent::__construct();
            }

            public function getRaw(string $name): array
            {
                return ['APP_KEY=secret'];
            }
        };
    }

    protected function command(): EnvPushCommand
    {
        $client = $this->failingClient();
        $env = $this->stubEnv();

        $command = new class($client, $env) extends EnvPushCommand
        {
            public function __construct(GhostableConsoleClient $client, Env $env)
            {
                parent::__construct();
                $this->ghostable = $client;
                $this->env = $env;
            }

            protected function ensureAccessTokenIsAvailable(): void
            {
                // Skip token check in tests
            }
        };

        $app = new Application;
        $app->add($command);

        return $app->find('env:push');
    }

    public function test_push_validation_errors_are_displayed_and_fails(): void
    {
        Container::setInstance(new Container);

        $manifest = tempnam(sys_get_temp_dir(), 'manifest').'.yml';
        file_put_contents($manifest, Yaml::dump([
            'id' => 'p1',
            'name' => 'Test',
            'environments' => ['local'],
        ]));

        Prompt::fake([Key::ENTER]);

        $tester = new CommandTester($this->command());

        ob_start();
        $status = $tester->execute(['--environment' => 'local', '--manifest' => $manifest]);
        $output = ob_get_clean().$tester->getDisplay();

        $this->assertSame(Command::FAILURE, $status);
        $this->assertStringContainsString('Push failed due to validation errors:', $output);
        $this->assertStringContainsString('  - bad', $output);
    }
}
