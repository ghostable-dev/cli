<?php

namespace Ghostable;

use Ghostable\Api\Adapter;
use Ghostable\Api\V1Adapter;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ClientException;
use Psr\Http\Message\ResponseInterface;

class GhostableConsoleClient
{
    private const TYPE_JSON = 'application/json';

    private const TYPE_PLAIN = 'text/plain';

    private const POST = 'POST';

    private const GET = 'GET';

    protected array $supportedVersions = [];

    public function __construct(
        protected Adapter $adapter = new V1Adapter,
        protected string $baseUrl = 'https://ghostable.dev',
        protected ?string $token = null,
        protected ?Client $httpClient = null
    ) {}

    /**
     * Attempt to authenticate the user and return the API response.
     *
     * @return array<string,mixed>
     */
    public function login(
        string $email,
        string $password,
        ?string $code = null
    ): array {
        $payload = [
            'email' => $email,
            'password' => $password,
        ];

        if ($code) {
            $payload['code'] = $code;
        }

        return $this->requestJson(self::POST, '/cli/login', $payload);
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
    public function envFormats(): array
    {
        return $this->requestJson(self::GET, '/environment-formats')['data'] ?? [];
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
    public function suggestedEnvironmentNames(string $projectId, string $type): array
    {
        return $this->requestJson(
            self::POST,
            "/projects/{$projectId}/generate-suggested-environment-names",
            ['type' => $type]
        )['data'] ?? [];
    }

    /**
     * @return array<string,mixed>
     */
    public function createEnvironment(
        string $projectId,
        string $name,
        string $type,
        ?string $baseId = null
    ): array {
        return $this->requestJson(
            self::POST,
            "/projects/{$projectId}/environments",
            [
                'name' => $name,
                'type' => $type,
                'base_id' => $baseId,
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

    public function pull(string $projectId, string $name, ?string $format = null): string
    {
        $uri = "/projects/{$projectId}/environments/{$name}/pull";

        if ($format) {
            $uri .= "?format={$format}";
        }

        return $this->requestRaw(self::GET, $uri);
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
     * @param  array<int, string>  $vars
     * @return array<string,mixed>
     */
    public function validateEnvironment(string $projectId, string $name, array $vars): array
    {
        return $this->requestJson(
            self::POST,
            "/projects/{$projectId}/environments/{$name}/validate",
            ['vars' => $vars]
        );
    }

    /**
     * Determine the differences between the provided variables and the
     * current state of an environment.
     *
     * @param  array<int, string>  $vars
     * @return array<string,mixed>
     */
    public function diffEnvironment(string $projectId, string $name, array $vars): array
    {
        return $this->requestJson(
            self::POST,
            "/projects/{$projectId}/environments/{$name}/diff",
            ['vars' => $vars]
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
            $response = $this->client()->request(
                $method,
                ltrim($this->adapter->uri($uri), '/'),
                [
                    'headers' => array_filter([
                        'Accept' => self::TYPE_PLAIN,
                        'Authorization' => $this->authorizationHeader(),
                    ]),
                ]
            );

            $this->handleResponseHeaders($response);

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
            $response = $this->client()->request(
                $method,
                ltrim($this->adapter->uri($uri), '/'),
                [
                    'json' => $json,
                    'headers' => array_filter([
                        'Accept' => $acceptType,
                        'Content-Type' => $acceptType,
                        'Authorization' => $this->authorizationHeader(),
                    ]),
                ]
            );

            $this->handleResponseHeaders($response);

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
        $path = $e->getRequest()->getUri()->getPath();

        if ($status === 401) {
            if (str_contains($path, '/cli/login')) {
                echo "❌ Authentication failed.\n";
            } else {
                echo "❌ Unauthorized. Run `ghostable login` first.\n";
            }
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
     * Handle version-related response headers.
     */
    protected function handleResponseHeaders(ResponseInterface $response): void
    {
        if ($versions = $response->getHeaderLine('X-Ghostable-Api-Versions')) {
            $this->supportedVersions = array_map('trim', explode(',', $versions));
        }

        if ($deprecated = $response->getHeaderLine('X-Ghostable-Deprecation')) {
            echo "⚠️ API version {$this->adapter->version()} is deprecated. {$deprecated}\n";
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
     * Expose the supported API versions provided by the server.
     *
     * @return array<int, string>
     */
    public function supportedVersions(): array
    {
        return $this->supportedVersions;
    }

    /**
     * Create the configured Guzzle client.
     */
    protected function client(): Client
    {
        if ($this->httpClient) {
            return $this->httpClient;
        }

        return $this->httpClient = new Client([
            'base_uri' => $this->baseUrl,
            'timeout' => 10,
        ]);
    }
}
