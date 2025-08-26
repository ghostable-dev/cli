<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;
use Symfony\Component\Console\Input\InputOption;

use function Laravel\Prompts\select;

class OrganizationSwitchCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('organization:switch')
            ->setAliases(['switch'])
            ->addOption('id', null, InputOption::VALUE_OPTIONAL, 'The ID of the organization to switch to')
            ->setDescription('Switch to a different organization context. You may optionally pass a organization ID.');
    }

    public function handle(): int
    {
        $this->ensureAccessTokenIsAvailable();

        $organizations = $this->ghostable->organizations();

        if (empty($organizations)) {
            Helpers::abort('No organizations available. Try creating a organization first.');
        }

        $idOption = $this->option('id');

        $organizationId = $idOption
            ? $this->resolveOrganizationIdFromOption($idOption, $organizations)
            : $this->promptForOrganizationId($organizations);

        $this->config->setOrganization($organizationId);

        $organizationName = collect($organizations)->firstWhere('id', $organizationId)['name'] ?? $organizationId;
        Helpers::info("✅ Using organization: <comment>{$organizationName}</comment>");

        return Command::SUCCESS;
    }

    protected function resolveOrganizationIdFromOption(mixed $id, array $organizations): string
    {
        $organization = collect($organizations)->firstWhere('id', $id);

        if (! $organization) {
            Helpers::abort("Organization [{$id}] not found.");
        }

        return $organization['id'];
    }

    protected function promptForOrganizationId(array $organizations): string
    {
        return select(
            'Which organization would you like to switch to?',
            collect($organizations)
                ->sortBy('name')
                ->mapWithKeys(fn ($organization) => [$organization['id'] => $organization['name']])
                ->all()
        );
    }
}
