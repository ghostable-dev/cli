<?php

namespace Ghostable\Commands;

use function Laravel\Prompts\table;

class OrganizationListCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('organization:list')
            ->setDescription('List the organizations that you belong to.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $currentOrganizationId = $this->config->getOrganization();

        table(
            headers: ['ID', 'Name', 'Current'],
            rows: collect($this->ghostable->organizations())
                ->sortBy(fn ($organization) => $organization['name'])
                ->map(function ($organization) use ($currentOrganizationId) {
                    return [
                        $organization['id'],
                        $organization['name'],
                        $currentOrganizationId === $organization['id'] ? '✅' : '',
                    ];
                })->values()
        );

        return Command::SUCCESS;
    }
}
