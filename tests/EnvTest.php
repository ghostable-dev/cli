<?php

namespace Ghostable\Tests;

use Ghostable\Env\Env;
use Illuminate\Container\Container;
use Symfony\Component\Yaml\Yaml;

class EnvTest extends TestCase
{
    public function test_resolve_path_uses_environment_type(): void
    {
        Container::setInstance(new Container);

        $dir = sys_get_temp_dir().'/envtest'.uniqid();
        mkdir($dir);

        $manifest = $dir.'/ghostable.yml';
        file_put_contents($manifest, Yaml::dump([
            'id' => 'p1',
            'name' => 'Demo',
            'environments' => [
                'prod' => ['type' => 'production'],
            ],
        ]));

        Container::getInstance()->offsetSet('manifest', $manifest);

        $env = new Env($dir);

        $this->assertSame(
            "$dir/.env.production",
            $env->resolvePathForEnv('prod')
        );
    }

    public function test_resolve_path_rejects_directory_traversal(): void
    {
        Container::setInstance(new Container);

        $dir = sys_get_temp_dir().'/envtest'.uniqid();
        mkdir($dir);

        $manifest = $dir.'/ghostable.yml';
        file_put_contents($manifest, Yaml::dump([
            'id' => 'p1',
            'name' => 'Demo',
            'environments' => [],
        ]));

        Container::getInstance()->offsetSet('manifest', $manifest);

        $env = new Env($dir);

        $this->expectException(\InvalidArgumentException::class);
        $env->resolvePathForEnv('../evil');
    }

    public function test_resolve_path_rejects_dot_segments(): void
    {
        Container::setInstance(new Container);

        $dir = sys_get_temp_dir().'/envtest'.uniqid();
        mkdir($dir);

        $manifest = $dir.'/ghostable.yml';
        file_put_contents($manifest, Yaml::dump([
            'id' => 'p1',
            'name' => 'Demo',
            'environments' => [],
        ]));

        Container::getInstance()->offsetSet('manifest', $manifest);

        $env = new Env($dir);

        $this->expectException(\InvalidArgumentException::class);
        $env->resolvePathForEnv('..');
    }
}
