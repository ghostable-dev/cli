<?php

namespace Ghostable\Tests;

use Ghostable\Manifest;
use Illuminate\Container\Container;
use Symfony\Component\Yaml\Yaml;

class ManifestTest extends TestCase
{
    public function test_reads_team_information_from_manifest(): void
    {
        Container::setInstance(new Container);

        $dir = sys_get_temp_dir().'/manifesttest'.uniqid();
        mkdir($dir);

        $manifest = $dir.'/ghostable.yml';
        file_put_contents($manifest, Yaml::dump([
            'id' => 'p1',
            'name' => 'Demo',
            'team_id' => 't1',
            'team_name' => 'Team One',
            'environments' => [],
        ]));

        Container::getInstance()->offsetSet('manifest', $manifest);

        $this->assertSame('t1', Manifest::teamId());
        $this->assertSame('Team One', Manifest::teamName());
    }
}
