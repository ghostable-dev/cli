<?php

namespace Ghostable\Env;

use Dotenv\Parser\Parser;
use Ghostable\Manifest;

class Env
{
    /**
     * The Dotenv parsing engine.
     */
    private Parser $parser;

    /**
     * The root directory where .env files are expected to be located.
     *
     * Defaults to the current working directory unless explicitly overridden.
     * Used to resolve environment file paths like `.env`, `.env.staging`, etc.
     */
    private string $basePath;

    public function __construct(?string $basePath = null)
    {
        $this->basePath = $basePath ?? getcwd();

        $this->parser = new Parser;
    }

    /**
     * Retrieve and parse environment variables for the given environment.
     *
     * This method resolves the appropriate `.env` file path
     * for the specified environment, loads its contents, and parses
     * it into a structured array of EnvLine objects.
     *
     * The returned array includes valid variables, commented-out
     * entries, and invalid lines, each wrapped in an EnvLine object.
     *
     * @return array<int, EnvLine>
     *
     * @throws \RuntimeException If the file cannot be read
     */
    public function getParsed(string $name): array
    {
        $lines = $this->getRaw($name);

        return $this->parse($lines);
    }

    /**
     * Retrieve the raw lines from the .env file for the given environment.
     *
     * This method resolves the appropriate `.env` file path for the
     * specified environment and loads its contents as an array of
     * unmodified strings (one per line).
     *
     * @return array<int, string> The raw lines of the .env file
     *
     * @throws \RuntimeException If the file cannot be read
     */
    public function getRaw(string $name): array
    {
        $path = $this->resolvePathForEnv($name);

        return $this->load($path);
    }

    /**
     * Save environment contents to the appropriate .env file.
     *
     * Resolves the local path for the given environment name and writes
     * the provided contents to disk. Overwrites any existing file.
     *
     * @param  string  $name  The environment name (e.g. "local", "production")
     * @param  string  $contents  The full .env file content to write
     */
    public function save(string $name, string $contents): void
    {
        $path = $this->resolvePathForEnv($name);

        file_put_contents($path, $contents);
    }

    /**
     * Resolve the full file path for a given environment name.
     *
     * This returns the appropriate `.env` file path based
     * on the provided environment.
     * - "local" maps to `.env`
     * - Other environments (e.g., "production") map to `.env.production`
     */
    public function resolvePathForEnv(string $name): string
    {
        $type = Manifest::environmentType($name) ?? $name;

        $sanitized = ltrim(str($type)->trim()->lower(), '.');

        $path = "{$this->basePath}/.env";

        if ($sanitized !== 'local') {
            $path .= ".{$sanitized}";
        }

        return $path;
    }

    /**
     * Load the lines of a given .env file.
     *
     * Reads the specified file line by line, returning an array of strings.
     * Each line is preserved without trailing newlines.
     * If the file cannot be read, a RuntimeException is thrown.
     *
     * @throws \RuntimeException If the file cannot be read
     */
    public function load(string $path): array
    {
        $lines = @file($path, FILE_IGNORE_NEW_LINES);

        if ($lines === false) {
            throw new \RuntimeException("Could not read env file at: {$path}");
        }

        return $lines;
    }

    /**
     * Parse an array of lines from an .env file into structured EnvLine objects.
     *
     * This method processes each line using the parseLine() helper to detect and
     * parse environment variable entries. Commented-out variables and invalid lines
     * are preserved and wrapped as EnvLine objects with appropriate types.
     * Blank lines are skipped.
     *
     * @return array<int, EnvLine>
     */
    public function parse(array $lines): array
    {
        $results = [];

        foreach ($lines as $line) {
            $result = $this->parseLine($line);

            if ($result !== null) {
                $results[] = $result;
            }
        }

        return $results;
    }

    /**
     * Parse a single line from an .env file into a structured EnvLine object.
     *
     * This method handles detection of commented-out variables (e.g., "#FOO=bar"),
     * uses Dotenv's parser to handle quoting and escaping rules, and wraps the
     * result in an EnvLine value object. Blank lines return null, and lines that
     * cannot be parsed return an EnvLine of type INVALID.
     */
    private function parseLine(string $raw): ?EnvLine
    {
        $line = trim($raw);

        if ($line === '') {
            return null; // Skip blank lines
        }

        $commented = false;

        if ($this->isCommentedOutVariable($line)) {
            $commented = true;
            $line = ltrim($line, '# ');
        }

        try {
            $parsed = $this->parser->parse($line);
        } catch (\Throwable $e) {
            return new EnvLine(
                type: EnvLineType::INVALID,
                raw: $raw,
                error: $e->getMessage()
            );
        }

        foreach ($parsed as $entry) {
            return new EnvLine(
                type: EnvLineType::ENV,
                key: $entry->getName(),
                value: $entry->getValue()->get()->getChars(),
                commented: $commented,
                raw: $raw
            );
        }

        return null; // fallback, in case parsing yields no entries
    }

    /**
     * Determine if a line is a commented-out environment variable.
     *
     * A line is considered a commented-out variable if it starts with a `#`
     * and contains an `=` character, e.g., `#APP_DEBUG=false`.
     */
    private function isCommentedOutVariable(string $line): bool
    {
        return str_starts_with($line, '#') && str_contains($line, '=');
    }
}
