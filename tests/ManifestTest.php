<?php

namespace Ghostable\Tests;

use Ghostable\Manifest;
use Illuminate\Container\Container;
use Symfony\Component\Yaml\Yaml;

class ManifestTest extends TestCase
{
    protected function createManifest(array $contents): void
    {
        $dir = sys_get_temp_dir().'/manifesttest'.uniqid();
        mkdir($dir);
        $path = $dir.'/ghostable.yml';
        file_put_contents($path, Yaml::dump($contents));

        Container::setInstance(new Container);
        Container::getInstance()->offsetSet('manifest', $path);
    }

    public function test_environment_names_from_old_list_format(): void
    {
        $this->createManifest([
            'id' => 'p1',
            'name' => 'Demo',
            'environments' => ['prod', 'stage'],
        ]);

        $this->assertSame(['prod', 'stage'], Manifest::environmentNames());
    }

    public function test_environment_type_from_old_array_format(): void
    {
        $this->createManifest([
            'id' => 'p1',
            'name' => 'Demo',
            'environments' => [
                ['name' => 'prod', 'type' => 'production'],
                ['name' => 'stage'],
            ],
        ]);

        $this->assertSame('production', Manifest::environmentType('prod'));
        $this->assertNull(Manifest::environmentType('stage'));
    }
}
