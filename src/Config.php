<?php

namespace Ghostable;

use Illuminate\Support\Arr;

class Config
{
    const ACCESS_TOKEN = 'access_token';

    const TEAM = 'team';

    /**
     * Get the access token.
     */
    public static function getAccessToken(): ?string
    {
        return self::get(self::ACCESS_TOKEN, null);
    }

    /**
     * Get the current team.
     */
    public static function getTeam(): ?string
    {
        return self::get(self::TEAM, null);
    }

    /**
     * Get the given configuration value.
     */
    public static function get(string $key, mixed $default = null): mixed
    {
        return Arr::get(static::load(), $key, $default);
    }

    /**
     * Set the access token.
     */
    public static function setAccessToken(string $token): void
    {
        self::set(self::ACCESS_TOKEN, $token);
    }

    /**
     * Set the current team.
     */
    public static function setTeam(string $teamId): void
    {
        self::set(self::TEAM, $teamId);
    }

    /**
     * Store the given configuration value.
     */
    public static function set(string $key, mixed $value): void
    {
        $config = static::load();

        Arr::set($config, $key, $value);

        file_put_contents(static::path(), json_encode($config, JSON_PRETTY_PRINT));
    }

    /**
     * Load the entire configuration array.
     */
    public static function load(): array
    {
        if (! is_dir(dirname(static::path()))) {
            mkdir(dirname(static::path()), 0755, true);
        }

        if (file_exists(static::path())) {
            return json_decode(file_get_contents(static::path()), true);
        }

        return [];
    }

    /**
     * Get the path to the configuration file.
     */
    protected static function path(): string
    {
        $home = $_SERVER['HOME'] ?? $_SERVER['USERPROFILE'];

        return $home.'/.ghostable/config.json';
    }
}
