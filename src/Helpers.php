<?php

namespace Ghostable;

use Illuminate\Container\Container;
use Symfony\Component\Console\Output\OutputInterface;

class Helpers
{
    /**
     * Display a danger message and exit.
     */
    public static function abort(string $text): never
    {
        static::danger($text);

        exit(1);
    }

    /**
     * Resolve a service from the container.
     */
    public static function app(?string $name = null): mixed
    {
        $container = Container::getInstance();

        return $name
            ? $container->make($name)
            : $container;
    }

    /**
     * Get the console output instance.
     */
    protected static function output(): OutputInterface
    {
        return static::app('output');
    }

    /**
     * Display a comment message.
     */
    public static function comment(string $text): void
    {
        static::output()->writeln('<comment>'.$text.'</comment>');
    }

    /**
     * Display a danger message.
     */
    public static function danger(string $text): void
    {
        static::output()->writeln('<fg=red>'.$text.'</>');
    }

    /**
     * Display a warning message.
     */
    public static function warn(string $text): void
    {
        static::output()->writeln('<fg=yellow>'.$text.'</>');
    }

    /**
     * Display an informational message.
     */
    public static function info(string $text): void
    {
        static::output()->writeln('<info>'.$text.'</info>');
    }

    /**
     * Display a message.
     */
    public static function line(string $text = ''): void
    {
        static::output()->writeln($text);
    }
}
