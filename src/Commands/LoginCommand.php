<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use GuzzleHttp\Exception\ClientException;

use function Laravel\Prompts\form;
use function Laravel\Prompts\select;

class LoginCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('login')
            ->setDescription('Authenticate with Ghostable');
    }

    public function handle(): ?int
    {
        try {
            $token = $this->attemptLogin();
        } catch (ClientException $e) {
            Helpers::abort('Authentication failed ('.$e->getCode().')');
        }

        $this->store($token);

        $this->ensureCurrentOrganizationIsSet();

        return Command::SUCCESS;
    }

    protected function attemptLogin(): string
    {
        $input = form()
            ->text(name: 'email', label: 'Email', required: true)
            ->password(name: 'password', label: 'Password')
            ->submit();

        $response = $this->ghostable->login(
            email: $input['email'],
            password: $input['password'],
        );

        if (($response['two_factor'] ?? false) === true) {
            Helpers::comment(
                'Need to use a recovery code? Log in via https://ghostable.dev/login'.PHP_EOL
            );

            $twoFactor = form()
                ->password(name: 'code', label: 'Two-factor code')
                ->submit();

            $response = $this->ghostable->login(
                email: $input['email'],
                password: $input['password'],
                code: $twoFactor['code'] ?: null,
            );
        }

        if (! isset($response['token'])) {
            Helpers::abort('Authentication failed.');
        }

        return $response['token'];
    }

    protected function store(string $token): void
    {
        $this->config->setAccessToken($token);

        Helpers::info('✅ Authenticated successfully.'.PHP_EOL);
    }

    protected function ensureCurrentOrganizationIsSet(): void
    {
        $organizations = $this->ghostable->organizations();

        if (count($organizations) === 1) {
            /** @var array{id: string, name?: string} $organization */
            $organization = collect($organizations)->first();

            $this->config->setOrganization($organization['id']);

            $organizationName = $organization['name'] ?? $organization['id'];

            Helpers::info("✅ Using organization: <comment>{$organizationName}</comment>");

            return;
        }

        $organizationId = select(
            'Which organization would you like to use?',
            collect($organizations)
                ->sortBy('name')
                ->mapWithKeys(fn ($organization) => [$organization['id'] => $organization['name']])
                ->all(),
        );

        $this->config->setOrganization($organizationId);

        $organizationName = collect($organizations)->firstWhere('id', $organizationId)['name'] ?? $organizationId;

        Helpers::info("✅ Using organization: <comment>{$organizationName}</comment>");
    }
}
