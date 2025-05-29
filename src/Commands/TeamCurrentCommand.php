<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;

class TeamCurrentCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('team:current')
            ->setDescription('Determine your current team context.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $team = collect($this->ghostable->teams())
            ->where('id', $this->config->getTeam())
            ->first();

        if (! $team) {
            Helpers::abort('Unable to determine current team.');
        }

        Helpers::info('Current team: <comment>'.$team['name'].'</comment>');

        return Command::SUCCESS;
    }
}
