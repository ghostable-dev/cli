<?php

namespace Ghostable;

use Symfony\Component\Yaml\Yaml;

class Manifest
{
    public static function id(): string
    {
        if (! array_key_exists('id', static::current())) {
            Helpers::abort(sprintf('Invalid project ID. Please verify your Ghostable manifest at [%s].', self::resolve()));
        }

        return static::current()['id'];
    }

    public static function name(): string
    {
        if (! array_key_exists('name', static::current())) {
            Helpers::abort(sprintf('Invalid project name. Please verify your Ghostable manifest at [%s].', self::resolve()));
        }

        return static::current()['name'];
    }

    public static function resolve(): string
    {
        return Helpers::app('manifest');
    }

    public static function defaultPath(): string
    {
        return getcwd().'/ghostable.yml';
    }

    public static function current(): array
    {
        if (! file_exists(self::resolve())) {
            Helpers::abort(
                sprintf(
                    'Unable to find a Ghostable manifest at [%s].',
                    self::resolve()
                )
            );
        }

        return Yaml::parse(file_get_contents(self::resolve()));
    }

    public static function fresh(array $project): void
    {
        static::write(array_filter([
            'id' => $project['id'],
            'name' => $project['name'],
            'environments' => collect($project['environments'])
                ->map(fn ($env) => $env['name'])
                ->values()
                ->toArray(),
        ]));
    }

    public static function addEnvironment(string $environment): void
    {
        $manifest = static::current();

        $environments = collect($manifest['environments'] ?? [])
            ->filter(fn ($e) => is_string($e)) // Ensure list format
            ->push($environment)
            ->unique()
            ->sort()
            ->values()
            ->all();

        $manifest['environments'] = $environments;

        static::write($manifest);
    }

    protected static function write(array $manifest, $path = null): void
    {
        file_put_contents(
            $path ?: self::resolve(),
            Yaml::dump(input: $manifest, inline: 20, indent: 4)
        );
    }
}
