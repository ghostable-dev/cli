<?php

namespace Ghostable\Tests;

use Ghostable\Commands\EnvForgeCommand;
use Ghostable\Config;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Yaml\Yaml;

class EnvForgeCommandTest extends TestCase
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

    private function makeCommand(array $map, Client $client): EnvForgeCommand
    {
        $gc = new class($map) extends \Ghostable\GhostableConsoleClient
        {
            public function __construct(private array $map) {}

            public function fetch(string $projectId, string $env): array
            {
                $data = [];
                foreach ($this->map as $k => $v) {
                    $data[] = ['key' => $k, 'value' => $v];
                }

                return ['data' => $data];
            }
        };

        return new class($gc, $client) extends EnvForgeCommand
        {
            public function __construct(private $fakeClient, private $httpClient)
            {
                parent::__construct();
                $this->ghostable = $fakeClient;
                $this->getDefinition()->addOption(new InputOption('manifest'));
                $this->getDefinition()->addOption(new InputOption('api-version'));
                $this->getDefinition()->addOption(new InputOption('debug'));
            }

            protected function makeForgeClient(string $token): Client
            {
                return $this->httpClient;
            }
        };
    }

    public function test_updates_env_and_triggers_deploy(): void
    {
        $manifest = $this->makeManifest();

        $mock = new MockHandler([
            new Response(200, [], '{}'),
            new Response(200, [], '{}'),
        ]);
        $container = [];
        $history = Middleware::history($container);
        $stack = HandlerStack::create($mock);
        $stack->push($history);
        $client = new Client(['handler' => $stack]);

        $command = $this->makeCommand(['FOO' => 'bar'], $client);
        $tester = new CommandTester($command);
        $exit = $tester->execute([
            '--environment' => 'production',
            '--server' => '123',
            '--site' => '456',
            '--token' => 'forge-token',
            '--deploy' => true,
            '--manifest' => $manifest,
        ]);

        $this->assertSame(0, $exit);
        $this->assertCount(2, $container);
        $this->assertSame('PUT', $container[0]['request']->getMethod());
        $this->assertSame('servers/123/sites/456/env', $container[0]['request']->getUri()->getPath());
        $this->assertSame('content=FOO%3Dbar%0A', (string) $container[0]['request']->getBody());
        $this->assertSame('POST', $container[1]['request']->getMethod());
        $this->assertSame('servers/123/sites/456/deploy', $container[1]['request']->getUri()->getPath());
    }
}
