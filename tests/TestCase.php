<?php

namespace Ghostable\Tests;

use Ghostable\GhostableServiceProvider;
use Orchestra\Testbench\TestCase as Orchestra;

abstract class TestCase extends Orchestra
{
    protected function getPackageProviders($app)
    {
        // Registers your commands via the service provider
        return [
            GhostableServiceProvider::class,
        ];
    }

    /** {@inheritDoc} */
    protected function getEnvironmentSetUp($app)
    {
        // any env setup...
    }
}
