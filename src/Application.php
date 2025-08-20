<?php

namespace Ghostable;

use Symfony\Component\Console\Application as SymfonyConsoleApplication;
use Symfony\Component\Console\Input\InputDefinition;
use Symfony\Component\Console\Input\InputOption;

class Application extends SymfonyConsoleApplication
{
    protected function getDefaultInputDefinition(): InputDefinition
    {
        $definition = parent::getDefaultInputDefinition();

        $definition->addOption(
            new InputOption(
                'manifest',
                null,
                InputOption::VALUE_OPTIONAL,
                'The path to your ghostable.yml manifest'
            )
        );

        $definition->addOption(
            new InputOption(
                'api-version',
                null,
                InputOption::VALUE_OPTIONAL,
                'Override the Ghostable API version (default: v1)'
            )
        );

        $definition->addOption(
            new InputOption(
                'debug',
                null,
                InputOption::VALUE_NONE,
                'Display detailed API responses'
            )
        );

        return $definition;
    }
}
