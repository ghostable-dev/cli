<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use GuzzleHttp\Exception\ClientException;

use function Laravel\Prompts\form;

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

            return Command::FAILURE;
        }

        $this->store($token);

        $this->ensureCurrentTeamIsSet();

        return Command::SUCCESS;
    }

    protected function attemptLogin(): string
    {
        $input = form()
            ->text(name: 'email', label: 'Email', required: true)
            ->password(name: 'password', label: 'Password')
            ->submit();

        return $this->ghostable->login(
            email: $input['email'],
            password: $input['password'],
        );
    }

    protected function store(string $token): void
    {
        $this->config->setAccessToken($token);

        Helpers::info('Authenticated successfully.'.PHP_EOL);
    }

    protected function ensureCurrentTeamIsSet(): void
    {
        $teams = $this->ghostable->teams();

        $this->config->setTeam(collect($teams)->first(function ($team) {
            return isset($team['id']);
        })['id']);
    }
}
