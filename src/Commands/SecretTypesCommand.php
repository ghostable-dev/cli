<?php

namespace Ghostable\Commands;

use function Laravel\Prompts\table;

class SecretTypesCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('secret:types')
            ->setDescription('List the available secret types.');
    }

    public function handle(): ?int
    {
        $this->ensureAccessTokenIsAvailable();

        $types = $this->ghostable->secretTypes();

        table(
            headers: ['Value', 'Label'],
            rows: collect($types)->map(function ($type) {
                return [
                    $type['value'] ?? ($type['id'] ?? ''),
                    $type['label'] ?? ($type['name'] ?? ''),
                ];
            })->values()->all()
        );

        return Command::SUCCESS;
    }
}
