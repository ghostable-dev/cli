<?php

namespace Ghostable;

use Illuminate\Container\Container;
use Illuminate\Support\Carbon;

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
        return $name
            ? Container::getInstance()->make($name)
            : Container::getInstance();
    }

    /**
     * Display a comment message.
     */
    public static function comment(string $text): void
    {
        static::app('output')->writeln('<comment>'.$text.'</comment>');
    }

    /**
     * Display a danger message.
     */
    public static function danger(string $text): void
    {
        static::app('output')->writeln('<fg=red>'.$text.'</>');
    }

    /**
     * Display a warning message.
     */
    public static function warn(string $text): void
    {
        static::app('output')->writeln('<fg=yellow>'.$text.'</>');
    }

    /**
     * Get the home directory for the user.
     */
    public static function home(): string
    {
        return $_SERVER['HOME'] ?? $_SERVER['USERPROFILE'];
    }

    /**
     * Display an informational message.
     */
    public static function info(string $text): void
    {
        static::app('output')->writeln('<info>'.$text.'</info>');
    }

    /**
     * Get the file size in kilobytes.
     */
    public static function kilobytes(string $file): string
    {
        return round(filesize($file) / 1024, 2).'KB';
    }

    /**
     * Display a message.
     */
    public static function line(string $text = ''): void
    {
        static::app('output')->writeln($text);
    }

    /**
     * Get the file size in megabytes.
     */
    public static function megabytes(string $file): string
    {
        return round(filesize($file) / 1024 / 1024, 2).'MB';
    }

    /**
     * Display a "step" message.
     */
    public static function step(string $text): void
    {
        static::line('<fg=blue>==></> '.$text);
    }

    /**
     * Display the date in "humanized" time-ago form.
     */
    public static function time_ago(string $date): string
    {
        return Carbon::parse($date)->diffForHumans();
    }

    /**
     * Write text to the console.
     */
    public static function write(string $text): void
    {
        static::app('output')->write($text);
    }
}
