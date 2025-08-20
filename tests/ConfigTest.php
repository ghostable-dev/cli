<?php

namespace Ghostable\Tests;

use Ghostable\Config;

class ConfigTest extends TestCase
{
    public function test_ci_token_priority_order(): void
    {
        putenv('GHOSTABLE_CI_TOKEN=envtoken');
        $_ENV['GHOSTABLE_CI_TOKEN'] = 'envsuper';
        $_SERVER['GHOSTABLE_CI_TOKEN'] = 'servertoken';

        $this->assertSame('envtoken', Config::getCiToken());

        putenv('GHOSTABLE_CI_TOKEN');
        unset($_ENV['GHOSTABLE_CI_TOKEN'], $_SERVER['GHOSTABLE_CI_TOKEN']);
    }

    public function test_ci_token_from_server_when_no_other_sources(): void
    {
        putenv('GHOSTABLE_CI_TOKEN');
        unset($_ENV['GHOSTABLE_CI_TOKEN']);
        $_SERVER['GHOSTABLE_CI_TOKEN'] = 'servertoken';

        $this->assertSame('servertoken', Config::getCiToken());

        unset($_SERVER['GHOSTABLE_CI_TOKEN']);
    }

    public function test_api_version_prefers_environment_variable(): void
    {
        $home = sys_get_temp_dir().'/cfgtest'.uniqid();
        $_SERVER['HOME'] = $home;

        Config::setApiVersion('v2');

        putenv('GHOSTABLE_API_VERSION=v3');

        $this->assertSame('v3', Config::getApiVersion());

        putenv('GHOSTABLE_API_VERSION');
    }

    public function test_api_version_defaults_to_v1_when_not_set(): void
    {
        $home = sys_get_temp_dir().'/cfgtest'.uniqid();
        $_SERVER['HOME'] = $home;

        putenv('GHOSTABLE_API_VERSION');

        $this->assertSame('v1', Config::getApiVersion());
    }
}
