<?php

namespace Ghostable;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\ClientException;

class GhostableConsoleClient
{
    private const TYPE_JSON = 'application/json';

    private const TYPE_PLAIN = 'text/plain';

    private const POST = 'POST';

    private const GET = 'GET';

    public function __construct(
        protected string $baseUrl = 'https://ghostable.dev/api/',
        protected ?string $token = null
    ) {}

    public function login(string $email, string $password): ?string
    {
        $response = $this->requestJson(self::POST, '/cli/login', [
            'email' => $email,
            'password' => $password,
        ]);

        return $response['token'] ?? null;
    }

    /**
     * @return array<string,mixed>
     */
    public function user(): array
    {
        return $this->requestJson(
            self::GET,
            '/user'
        );
    }

    /**
     * @return array<string,mixed>
     */
    public function teams(): array
    {
        return $this->requestJson(
            self::GET,
            '/teams'
        )['data'] ?? [];
    }

    /**
     * @return array<string,mixed>
     */
    public function projects(string $teamId): array
    {
        return $this->requestJson(
            self::GET,
            "/teams/{$teamId}/projects"
        )['data'] ?? [];
    }

    /**
     * @return array<string,mixed>
     */
    public function createProject(string $teamId, string $name): array
    {
        return $this->requestJson(
            self::POST,
            "/teams/{$teamId}/projects",
            ['name' => $name]
        )['data'] ?? [];
    }

    /**
     * @return array<string,mixed>
     */
    public function envTypes(): array
    {
        return $this->requestJson(self::GET, '/environment-types')['data'] ?? [];
    }

    /**
     * @return array<string,mixed>
     */
    public function environments(string $projectId): array
    {
        return $this->requestJson(
            self::GET,
            "/projects/{$projectId}/environments"
        )['data'] ?? [];
    }

    /**
     * @return array<string,mixed>
     */
    public function createEnvironment(
        string $projectId,
        string $name,
        string $type,
        string $base
    ): array {
        return $this->requestJson(
            self::POST,
            "/projects/{$projectId}/environments",
            [
                'name' => $name,
                'type' => $type,
                'base' => $base,
            ]
        )['data'] ?? [];
    }

    /**
     * @return array<string,mixed>
     */
    public function push(string $projectId, string $name, array $vars): array
    {
        return $this->requestJson(
            self::POST,
            "/projects/{$projectId}/environments/{$name}/push",
            ['vars' => $vars]
        );
    }

    public function pull(string $projectId, string $name): string
    {
        return $this->requestRaw(
            self::GET,
            "/projects/{$projectId}/environments/{$name}/pull"
        );
    }

    public function deploy(): string
    {
        return $this->requestRaw(
            self::GET,
            '/ci/deploy'
        );
    }

    /**
     * Validate an environment and return the API response.
     *
     * @return array<string,mixed>
     */
    public function validateEnvironment(string $projectId, string $name): array
    {
        return $this->requestJson(
            self::POST,
            "/projects/{$projectId}/environments/{$name}/validate"
        );
    }

    /**
     * Perform a JSON API request.
     *
     * @return array<string,mixed>
     */
    protected function requestJson(string $method, string $uri, array $json = []): array
    {
        return $this->requestWithHeaders($method, $uri, self::TYPE_JSON, $json);
    }

    /**
     * Perform a plain-text request and return raw string body.
     */
    protected function requestRaw(string $method, string $uri): string
    {
        try {
            $response = $this->client()->request($method, ltrim($uri, '/'), [
                'headers' => array_filter([
                    'Accept' => self::TYPE_PLAIN,
                    'Authorization' => $this->authorizationHeader(),
                ]),
            ]);

            return (string) $response->getBody();
        } catch (ClientException $e) {
            $this->handleRequestError($e);
            throw $e;
        }
    }

    /**
     * Perform a JSON-based request with standard headers.
     *
     * @param  $json  array<string,mixed>
     * @return array<string,mixed>
     */
    protected function requestWithHeaders(
        string $method,
        string $uri,
        string $acceptType,
        array $json = []
    ): array {
        try {
            $response = $this->client()->request($method, ltrim($uri, '/'), [
                'json' => $json,
                'headers' => array_filter([
                    'Accept' => $acceptType,
                    'Content-Type' => $acceptType,
                    'Authorization' => $this->authorizationHeader(),
                ]),
            ]);

            return json_decode((string) $response->getBody(), true) ?? [];
        } catch (ClientException $e) {
            $this->handleRequestError($e);
            throw $e;
        }
    }

    /**
     * Output friendly error messages for common API exceptions.
     */
    protected function handleRequestError(ClientException $e): void
    {
        $status = $e->getResponse()->getStatusCode();
        $body = (string) $e->getResponse()->getBody();

        if ($status === 401) {
            echo "❌ Unauthorized. Run `ghostable login` first.\n";
        } elseif ($status === 422) {
            $data = json_decode($body, true);
            foreach (($data['errors'] ?? []) as $field => $messages) {
                foreach ((array) $messages as $message) {
                    echo "  - {$message}\n";
                }
            }
        } else {
            echo "❌ API Error ({$status}): {$body}\n";
        }
    }

    /**
     * Get the Authorization header for the current CLI user.
     */
    protected function authorizationHeader(): ?string
    {
        return $this->token ? 'Bearer '.$this->token : null;
    }

    /**
     * Create the configured Guzzle client.
     */
    protected function client(): Client
    {
        return new Client([
            'base_uri' => $this->baseUrl,
            'timeout' => 10,
        ]);
    }
}
