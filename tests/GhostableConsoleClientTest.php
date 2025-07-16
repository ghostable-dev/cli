<?php

namespace Ghostable\Tests;

use Ghostable\GhostableConsoleClient;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Psr7\Request;

class GhostableConsoleClientTest extends TestCase
{
    /**
     * Create a testable console client with queued responses.
     */
    protected function client(array $queue, ?string $token = null, array &$history = []): GhostableConsoleClient
    {
        $mock = new MockHandler($queue);
        $historyMiddleware = Middleware::history($history);
        $stack = HandlerStack::create($mock);
        $stack->push($historyMiddleware);

        $guzzle = new Client(['handler' => $stack]);

        return new class($guzzle, $token) extends GhostableConsoleClient {
            public function __construct(private Client $client, private ?string $token)
            {
                parent::__construct();
            }

            protected function authorizationHeader(): ?string
            {
                return $this->token ? 'Bearer ' . $this->token : null;
            }

            protected function client(): Client
            {
                return $this->client;
            }
        };
    }

    public function test_login_returns_token_and_sends_credentials(): void
    {
        $history = [];
        $client = $this->client([
            new Response(200, [], json_encode(['token' => 'abc']))
        ], null, $history);

        $token = $client->login('jane@example.com', 'secret');

        $this->assertSame('abc', $token);
        $this->assertCount(1, $history);
        $request = $history[0]['request'];
        $this->assertSame('POST', $request->getMethod());
        $this->assertSame('cli/login', $request->getRequestTarget());
        $this->assertSame('', $request->getHeaderLine('Authorization'));
        $body = json_decode((string) $request->getBody(), true);
        $this->assertSame(['email' => 'jane@example.com', 'password' => 'secret'], $body);
    }

    public function test_user_includes_authorization_header(): void
    {
        $history = [];
        $client = $this->client([
            new Response(200, [], json_encode(['id' => 1]))
        ], 'token', $history);

        $data = $client->user();

        $this->assertSame(['id' => 1], $data);
        $request = $history[0]['request'];
        $this->assertSame('Bearer token', $request->getHeaderLine('Authorization'));
        $this->assertSame('GET', $request->getMethod());
        $this->assertSame('user', $request->getRequestTarget());
    }

    public function test_projects_and_create_project(): void
    {
        $history = [];
        $client = $this->client([
            new Response(200, [], json_encode(['data' => [['id' => 1]]] )),
            new Response(200, [], json_encode(['data' => ['id' => 2]] ))
        ], 'tok', $history);

        $projects = $client->projects('99');
        $created = $client->createProject('99', 'my app');

        $this->assertSame([['id' => 1]], $projects);
        $this->assertSame(['id' => 2], $created);
        $this->assertCount(2, $history);
        $this->assertSame('teams/99/projects', $history[0]['request']->getRequestTarget());
        $this->assertSame('teams/99/projects', $history[1]['request']->getRequestTarget());
    }

    public function test_env_types_and_create_environment(): void
    {
        $history = [];
        $client = $this->client([
            new Response(200, [], json_encode(['data' => ['laravel']])),
            new Response(200, [], json_encode(['data' => ['id' => 3]]))
        ], 'a', $history);

        $types = $client->envTypes();
        $env = $client->createEnvironment('p1', 'Prod', 'laravel');

        $this->assertSame(['laravel'], $types);
        $this->assertSame(['id' => 3], $env);
        $this->assertCount(2, $history);
        $this->assertSame('environment-types', $history[0]['request']->getRequestTarget());
        $this->assertSame('projects/p1/environments', $history[1]['request']->getRequestTarget());
    }

    public function test_push_sends_variables_and_returns_response(): void
    {
        $history = [];
        $client = $this->client([
            new Response(200, [], json_encode(['ok' => true]))
        ], 't', $history);

        $result = $client->push('123', 'production', ['FOO' => 'bar']);

        $this->assertSame(['ok' => true], $result);
        $request = $history[0]['request'];
        $body = json_decode((string) $request->getBody(), true);
        $this->assertSame(['vars' => ['FOO' => 'bar']], $body);
        $this->assertSame('projects/123/environments/production/push', $request->getRequestTarget());
    }

    public function test_pull_returns_plain_text(): void
    {
        $history = [];
        $client = $this->client([
            new Response(200, [], "FOO=bar\n")
        ], 'tok', $history);

        $result = $client->pull('321', 'dev');

        $this->assertSame("FOO=bar\n", $result);
        $request = $history[0]['request'];
        $this->assertSame('projects/321/environments/dev/pull', $request->getRequestTarget());
    }

    public function test_handle_request_error_outputs_unauthorized_message(): void
    {
        $history = [];
        $exception = new ClientException(
            'Unauthorized',
            new Request('GET', '/user'),
            new Response(401)
        );
        $client = $this->client([$exception], 'x', $history);

        ob_start();
        try {
            $client->user();
        } catch (ClientException $e) {
            $output = ob_get_clean();
            $this->assertStringContainsString('❌ Unauthorized. Run `ghostable login` first.', $output);
        }
    }

    public function test_handle_request_error_outputs_validation_messages(): void
    {
        $history = [];
        $response = new Response(422, [], json_encode(['errors' => ['field' => ['bad']]]));
        $exception = new ClientException('invalid', new Request('POST', '/test'), $response);
        $client = $this->client([$exception], 'x', $history);

        ob_start();
        try {
            $client->createProject('1', 'test');
        } catch (ClientException $e) {
            $output = ob_get_clean();
            $this->assertStringContainsString('  - bad', $output);
        }
    }

    public function test_handle_request_error_outputs_generic_message(): void
    {
        $history = [];
        $response = new Response(500, [], 'fail');
        $exception = new ClientException('oops', new Request('GET', '/x'), $response);
        $client = $this->client([$exception], 'x', $history);

        ob_start();
        try {
            $client->user();
        } catch (ClientException $e) {
            $output = ob_get_clean();
            $this->assertStringContainsString('❌ API Error (500): fail', $output);
        }
    }
}

