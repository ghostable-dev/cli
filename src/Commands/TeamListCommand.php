<?php

namespace Ghostable\Commands;

use function Laravel\Prompts\table;

class TeamListCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('team:list')
            ->setDescription('List the teams that you belong to.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $currentTeamId = $this->config->getTeam();

        table(
            headers: ['ID', 'Name', 'Current'],
            rows: collect($this->ghostable->teams())
                ->sortBy(fn ($team) => $team['name'])
                ->map(function ($team) use ($currentTeamId) {
                    return [
                        $team['id'],
                        $team['name'],
                        $currentTeamId === $team['id'] ? '✅' : '',
                    ];
                })->values()
        );

        return Command::SUCCESS;
    }
}
