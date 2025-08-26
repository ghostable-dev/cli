<?php

namespace Ghostable\Commands;

use Ghostable\Helpers;

class OrganizationCurrentCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('organization:current')
            ->setDescription('Determine your current organization context.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $organization = collect($this->ghostable->organizations())
            ->where('id', $this->config->getOrganization())
            ->first();

        if (! $organization) {
            Helpers::abort('Unable to determine current organization.');
        }

        Helpers::info('Current organization: <comment>'.$organization['name'].'</comment>');

        return Command::SUCCESS;
    }
}
