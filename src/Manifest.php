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
                ->map(function ($env) {
                    return [
                        'name' => $env['name'],
                        'type' => $env['type'] ?? null,
                    ];
                })
                ->values()
                ->toArray(),
        ]));
    }

    public static function addEnvironment(array $environment): void
    {
        $manifest = static::current();

        $environments = collect($manifest['environments'] ?? [])
            ->map(function ($e) {
                return is_string($e)
                    ? ['name' => $e, 'type' => null]
                    : $e;
            })
            ->push([
                'name' => $environment['name'],
                'type' => $environment['type'] ?? null,
            ])
            ->unique('name')
            ->sortBy('name')
            ->values()
            ->all();

        $manifest['environments'] = $environments;

        static::write($manifest);
    }

    /**
     * @return array<int, string>
     */
    public static function environmentNames(): array
    {
        return collect(static::current()['environments'] ?? [])
            ->map(fn ($env) => is_array($env) ? $env['name'] : $env)
            ->values()
            ->toArray();
    }

    public static function environmentType(string $name): ?string
    {
        $env = collect(static::current()['environments'] ?? [])
            ->map(function ($env) {
                return is_array($env)
                    ? $env
                    : ['name' => $env, 'type' => null];
            })
            ->firstWhere('name', $name);

        return $env['type'] ?? null;
    }

    protected static function write(array $manifest, $path = null): void
    {
        file_put_contents(
            $path ?: self::resolve(),
            Yaml::dump(input: $manifest, inline: 20, indent: 4)
        );
    }
}
