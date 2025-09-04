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

        // Reinitialize the API client with the freshly issued token so that
        // subsequent requests during this command execution are authorized.
        $this->ghostable = $this->makeGhostableClient(token: $token);

        Helpers::info('✅ Authenticated successfully.'.PHP_EOL);
    }

    protected function ensureCurrentOrganizationIsSet(): void
    {
        $organizations = $this->ghostable->organizations();

        // 0 orgs → instruct user and stop
        if (count($organizations) === 0) {
            Helpers::abort(
                'No organizations found for this account.'.PHP_EOL.
                '→ Go to https://ghostable.dev/login to create a new organization or accept any pending invitations.'.PHP_EOL.
                'Then run: ghostable organization:switch'
            );
        }

        // 1 org → auto-select
        if (count($organizations) === 1) {
            /** @var array{id: string, name?: string} $organization */
            $organization = collect($organizations)->first();

            $this->config->setOrganization($organization['id']);

            $organizationName = $organization['name'] ?? $organization['id'];

            Helpers::info("✅ Using organization: <comment>{$organizationName}</comment>");

            return;
        }

        // Many orgs → let user pick (fall back to ID if name missing)
        $options = collect($organizations)
            ->map(fn ($org) => [
                'id' => $org['id'],
                'label' => trim(($org['name'] ?? '')." ({$org['id']})"),
            ])
            ->sortBy('label')
            ->mapWithKeys(fn ($o) => [$o['id'] => $o['label']])
            ->all();

        $organizationId = select(
            'Which organization would you like to use?',
            $options,
        );

        $this->config->setOrganization($organizationId);

        $organizationName = collect($organizations)->firstWhere('id', $organizationId)['name'] ?? $organizationId;

        Helpers::info("✅ Using organization: <comment>{$organizationName}</comment>");
    }
}
