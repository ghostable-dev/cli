<?php

namespace Ghostable\Commands;

use function Laravel\Prompts\table;

class ProjectListCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('project:list')
            ->setDescription('List the projects within the current team context.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $projects = $this->ghostable->projects(
            $this->config->getTeam()
        );

        table(
            headers: ['ID', 'Name', 'Environments'],
            rows: collect($projects)
                ->sortBy(fn ($project) => $project['name'])
                ->map(function ($project) {
                    return [
                        $project['id'],
                        $project['name'],
                        implode(', ', collect($project['environments'])
                            ->map(fn ($env) => $env['name'])
                            ->toArray()
                        ),
                    ];
                })->values()
        );

        return Command::SUCCESS;
    }
}
