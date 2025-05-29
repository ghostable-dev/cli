<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Ghostable\Manifest;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;

use function Laravel\Prompts\text;
use function Laravel\Prompts\select;

class EnvInitCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('env:init')
            ->addOption('name', null, InputOption::VALUE_OPTIONAL, 'The environment name')
            ->setDescription('Initialize a new environment in the current team and project context.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $projectId = Manifest::id();

        if (! $projectId) {
            Helpers::abort('No project is currently selected. Run `ghostable init` first.');
        }

        // Fetch environment types
        $types = $this->ghostable->envTypes(); // Should be an array like: [['value' => 'production', 'label' => 'Production'], ...]
        $typeOptions = collect($types)->mapWithKeys(fn ($t) => [$t['value'] => $t['label']])->all();

        $selectedType = select(
            label: 'What type of environment are you creating?',
            options: $typeOptions,
            scroll: 12
        );

        $name = $this->option('name') ?? text('What is the name of the environment?');

        // Create the environment on the server
        $env = $this->ghostable->createEnvironment(
            projectId: $projectId,
            name: $name,
            type: $selectedType,
        );

        Helpers::info("✅ Environment <comment>$name</comment> created successfully.");

        Manifest::addEnvironment($env['name']);

        return Command::SUCCESS;
    }
}