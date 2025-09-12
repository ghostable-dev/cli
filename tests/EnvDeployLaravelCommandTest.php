<?php

namespace Ghostable\Tests;

use Ghostable\Commands\EnvDeployLaravelCommand;
use Ghostable\Contracts\EnvBuilder;
use Ghostable\Contracts\EnvRenderer;
use Ghostable\Contracts\EnvVarExtractor;
use Ghostable\Support\ChildEnvBuilder;
use Ghostable\Support\DefaultEnvRenderer;
use Ghostable\Support\DefaultEnvVarExtractor;
use Illuminate\Container\Container;

class EnvDeployLaravelCommandTest extends TestCase
{
    public function test_merges_variables_into_dotenv_file(): void
    {
        Container::setInstance($container = new Container);
        $container->bind(EnvVarExtractor::class, fn () => new DefaultEnvVarExtractor(skipComments: true));
        $container->bind(EnvBuilder::class, fn () => new ChildEnvBuilder);
        $container->bind(EnvRenderer::class, fn () => new DefaultEnvRenderer);

        $cwd = getcwd();
        $dir = sys_get_temp_dir().'/envdeploylaravel'.uniqid();
        mkdir($dir);
        chdir($dir);
        file_put_contents('.env', "EXISTING=1\n");
        file_put_contents('ghostable.yml', "id: p1\nname: Demo\nenvironments: []\n");
        Container::getInstance()->offsetSet('manifest', getcwd().'/ghostable.yml');

        $command = new class extends EnvDeployLaravelCommand
        {
            public function runMerge(array $vars): void
            {
                $this->mergeIntoEnvFile($vars);
            }
        };

        $command->runMerge([
            'EXISTING' => '2',
            'NEW' => 'n',
        ]);

        $content = file_get_contents('.env');
        $this->assertStringContainsString("EXISTING=2\n", $content);
        $this->assertStringContainsString("NEW=n\n", $content);

        chdir($cwd);
    }
}
