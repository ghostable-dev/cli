<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;

use function Laravel\Prompts\form;
use function Laravel\Prompts\select;

class InitCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('init')
            ->setDescription('Initialize a new project in the current directory within the current team context.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $project = $this->determineProject();

        Manifest::fresh($project);

        Helpers::info("✅ {$project['name']} initialized. ghostable.yaml created.");

        return Command::SUCCESS;
    }

    protected function determineProject(): array
    {
        $projects = $this->ghostable->projects(
            $this->config->getTeam()
        );

        $selection = select(
            label: 'Which project should this directory be linked to?',
            options: array_merge(
                ['new' => '[Create a new project]'], collect($projects)
                    ->mapWithKeys(fn ($project) => [$project['id'] => $project['name']])
                    ->toArray()),
            required: true,
            default: 'new',
            scroll: 10,
            hint: 'Select from existing projects or choose "Create a new project".'
        );

        if ($selection !== 'new') {
            return collect($projects)->firstWhere('id', $selection);
        }

        $newProjectData = form()
            ->text(
                name: 'name',
                label: 'What is the name of this project',
                required: true
            )->submit();

        $project = $this->ghostable->createProject(
            teamId: $this->config->getTeam(),
            name: $newProjectData['name']
        );

        return $project;
    }
}
