<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Symfony\Component\Console\Input\InputOption;

use function Laravel\Prompts\select;

class TeamSwitchCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('team:switch')
            ->setAliases(['switch'])
            ->addOption('id', null, InputOption::VALUE_OPTIONAL, 'The ID of the team to switch to')
            ->setDescription('Switch to a different team context. You may optionally pass a team ID.');
    }

    public function handle(): int
    {
        $this->ensureAccessTokenIsAvailable();

        $teams = $this->ghostable->teams();

        if (empty($teams)) {
            Helpers::abort('No teams available. Try creating a team first.');
        }

        $idOption = $this->option('id');

        $teamId = $idOption
            ? $this->resolveTeamIdFromOption($idOption, $teams)
            : $this->promptForTeamId($teams);

        $this->config->setTeam($teamId);

        $teamName = collect($teams)->firstWhere('id', $teamId)['name'] ?? $teamId;
        Helpers::info("Switched to team: <comment>{$teamName}</comment>");

        return Command::SUCCESS;
    }

    protected function resolveTeamIdFromOption(mixed $id, array $teams): string
    {
        $team = collect($teams)->firstWhere('id', $id);

        if (! $team) {
            Helpers::abort("Team [{$id}] not found.");
        }

        return $team['id'];
    }

    protected function promptForTeamId(array $teams): string
    {
        return select(
            'Which team would you like to switch to?',
            collect($teams)
                ->sortBy('name')
                ->mapWithKeys(fn ($team) => [$team['id'] => $team['name']])
                ->all()
        );
    }
}
