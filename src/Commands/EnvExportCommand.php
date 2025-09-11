<?php

namespace Ghostable\Commands;

use Ghostable\Contracts\EnvRenderer;
use Ghostable\Contracts\EnvVarExtractor;
use Ghostable\Helpers;
use Ghostable\Manifest;
use RuntimeException;
use Symfony\Component\Console\Input\InputOption;
use Throwable;

class EnvExportCommand extends Command
{
    protected EnvVarExtractor $extractor;

    protected EnvRenderer $renderer;

    public function __construct()
    {
        $this->extractor = Helpers::app(EnvVarExtractor::class);

        $this->renderer = Helpers::app(EnvRenderer::class);

        parent::__construct();
    }

    protected function configure(): void
    {
        $this->setName('env:export')
            ->setDescription('Print resolved environment variables.')
            ->addOption('token', null, InputOption::VALUE_OPTIONAL, 'Ghostable CLI token (env-scoped)')
            ->addOption('environment', 'e', InputOption::VALUE_REQUIRED, 'Environment name (required if no --token)')
            ->addOption('format', 'f', InputOption::VALUE_REQUIRED, 'Output format: dotenv|shell', 'dotenv')
            ->addOption('keys', 'k', InputOption::VALUE_REQUIRED, 'Comma-separated list of keys to include')
            ->addOption('redact', null, InputOption::VALUE_NEGATABLE, 'Redact secret values', true)
            ->addOption('sort', null, InputOption::VALUE_NEGATABLE, 'Sort by key name', true)
            ->addOption('newline', null, InputOption::VALUE_NEGATABLE, 'End output with a newline', true)
            ->addOption('print', 'p', InputOption::VALUE_REQUIRED, 'Print only the value of a single key');
    }

    public function handle(): ?int
    {
        $explicitToken = $this->option('token'); // <-- optional explicit CLI token decides the code path
        $format = strtolower((string) ($this->option('format') ?: 'dotenv'));
        $keysOpt = $this->option('keys');
        $redact = (bool) $this->option('redact');
        $sort = (bool) $this->option('sort');
        $newline = (bool) $this->option('newline');
        $print = $this->option('print');

        if (! in_array($format, ['dotenv', 'shell'], true)) {
            $this->writeError('ERR[5] Unsupported format. Use "dotenv" or "shell".');

            return 5;
        }

        if (! $redact && ! $this->isInteractive()) {
            $this->writeError('ERR[3] --no-redact is only allowed on an interactive TTY.');

            return 3;
        }

        // Fetch & extract variables
        try {
            $payload = $this->getVars($explicitToken);
            $vars = $this->extractor->extract($payload);
        } catch (Throwable $e) {
            $this->writeError('ERR[5] Environment resolution failed.');

            return 5;
        }

        // Single-key mode
        if ($print !== null) {
            $out = $this->renderer->renderSingle($vars, (string) $print, $format, $redact, $newline);
            $this->writeInfo($out);

            return self::SUCCESS;
        }

        // Render
        $onlyKeys = $keysOpt
            ? array_values(array_filter(array_map('trim', explode(',', (string) $keysOpt)), fn ($k) => $k !== ''))
            : null;
        $out = $this->renderer->render($vars, $format, $onlyKeys, $onlyKeys ? false : $sort, $redact, $newline);
        $this->writeLine($out);

        return self::SUCCESS;
    }

    protected function getVars(?string $token): array
    {
        // Explicit token → make an ad-hoc client and call deploy()
        if ($token !== null && $token !== '') {
            $client = $this->makeGhostableClient(token: (string) $token);

            return $client->deploy();
        }

        // No explicit token → require env and use the existing client
        $env = (string) ($this->option('environment') ?? '');
        if ($env === '') {
            throw new RuntimeException('ERR[5] Environment not specified (use --environment|-e).');
        }

        // $this->ghostable must already be authenticated (CI token/config)
        return $this->ghostable->pull(Manifest::id(), $env, null, true);
    }
}
