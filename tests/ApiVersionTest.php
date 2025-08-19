<?php

namespace Ghostable\Tests;

use Ghostable\Api\V2Adapter;
use Ghostable\GhostableConsoleClient;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;

class ApiVersionTest extends TestCase
{
    public function test_default_version_is_v1(): void
    {
        $container = [];
        $history = Middleware::history($container);
        $mock = new MockHandler([new Response(200, [])]);
        $handler = HandlerStack::create($mock);
        $handler->push($history);

        $client = new Client(['handler' => $handler, 'base_uri' => 'https://ghostable.dev']);

        $ghostable = new GhostableConsoleClient(httpClient: $client);
        $ghostable->user();

        $this->assertSame('/api/v1/user', $container[0]['request']->getUri()->getPath());
    }

    public function test_can_explicitly_use_v2(): void
    {
        $container = [];
        $history = Middleware::history($container);
        $mock = new MockHandler([new Response(200, [])]);
        $handler = HandlerStack::create($mock);
        $handler->push($history);

        $client = new Client(['handler' => $handler, 'base_uri' => 'https://ghostable.dev']);

        $ghostable = new GhostableConsoleClient(adapter: new V2Adapter, httpClient: $client);
        $ghostable->user();

        $this->assertSame('/api/v2/user', $container[0]['request']->getUri()->getPath());
    }
}
