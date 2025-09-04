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
                    'Unable to find a Ghostable manifest at [%s].'. PHP_EOL.
                    '→ Run <comment>ghostable init</comment> to generate a new manifest file.',
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
                ->mapWithKeys(function ($env) {
                    return [
                        $env['name'] => array_filter([
                            'type' => $env['type'] ?? null,
                        ]),
                    ];
                })
                ->sortKeys()
                ->toArray(),
        ]));
    }

    public static function addEnvironment(array $environment): void
    {
        $manifest = static::current();

        $environments = $manifest['environments'] ?? [];

        // Convert from old list format if necessary
        if (array_keys($environments) === range(0, count($environments) - 1)) {
            $environments = collect($environments)
                ->mapWithKeys(function ($e) {
                    return is_string($e)
                        ? [$e => []]
                        : [$e['name'] => array_filter(['type' => $e['type'] ?? null])];
                })
                ->toArray();
        }

        $environments[$environment['name']] = array_filter([
            'type' => $environment['type'] ?? null,
        ]);

        ksort($environments);

        $manifest['environments'] = $environments;

        static::write($manifest);
    }

    /**
     * @return array<int, string>
     */
    public static function environmentNames(): array
    {
        $environments = static::current()['environments'] ?? [];

        // If the environments are stored as a numerically indexed list (old format)
        if (array_keys($environments) === range(0, count($environments) - 1)) {
            return collect($environments)
                ->map(fn ($env) => is_array($env) ? $env['name'] : $env)
                ->values()
                ->toArray();
        }

        return array_keys($environments);
    }

    public static function environmentType(string $name): ?string
    {
        $environments = static::current()['environments'] ?? [];

        // Old list-based format
        if (array_keys($environments) === range(0, count($environments) - 1)) {
            $env = collect($environments)
                ->map(function ($env) {
                    return is_array($env)
                        ? $env
                        : ['name' => $env, 'type' => null];
                })
                ->firstWhere('name', $name);

            return $env['type'] ?? null;
        }

        return $environments[$name]['type'] ?? null;
    }

    protected static function write(array $manifest, $path = null): void
    {
        file_put_contents(
            $path ?: self::resolve(),
            Yaml::dump(input: $manifest, inline: 20, indent: 4)
        );
    }
}
