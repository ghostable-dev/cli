<?php

namespace Ghostable\Commands;

use GuzzleHttp\Exception\ClientException;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Process\Process;
use Throwable;

class EnvDeployVaporCommand extends EnvDeployCommand
{
    protected function configure(): void
    {
        parent::configure();

        $this->setName('deploy:vapor')
            ->setDescription('Sync Ghostable variables into Laravel Vapor Secrets.')
            ->addOption('vapor-env', null, InputOption::VALUE_OPTIONAL, 'Target Vapor environment', 'production');
    }

    public function handle(): ?int
    {
        $token = $this->option('token') ?? $this->config->getCiToken();
        $vaporEnv = (string) $this->option('vapor-env');

        if (! $token) {
            $this->writeLine('GHOSTABLE_CI_TOKEN environment variable is not set.');

            return Command::FAILURE;
        }

        try {
            $vars = $this->getVarsUsingToken($token);
        } catch (ClientException $e) {
            return Command::FAILURE;
        }

        if ($this->option('plan')) {
            $this->printPlan($vars);

            return Command::SUCCESS;
        }

        $this->writeLine(sprintf('Ghostable → Vapor (%d keys → %s)', count($vars), $vaporEnv));

        $failures = 0;

        foreach ($vars as $key => $value) {
            $tmp = tmpfile();
            $meta = stream_get_meta_data($tmp);
            $path = $meta['uri'];
            fwrite($tmp, (string) $value);
            fflush($tmp);

            try {
                $process = new Process(['vapor', 'secret', $vaporEnv, "--name={$key}", '--file', $path], null, null, null, 120);
                $process->run();

                if ($process->isSuccessful()) {
                    $this->writeLine("[OK]   {$key}");
                } else {
                    $failures++;
                    $error = trim($process->getErrorOutput() ?: $process->getOutput());
                    $this->writeLine("[ERR]  {$key} → {$error}");
                }
            } catch (Throwable $e) {
                $failures++;
                $this->writeLine("[ERR]  {$key} → {$e->getMessage()}");
            } finally {
                try {
                    fclose($tmp);
                } catch (Throwable $e) {
                    //
                }
            }
        }

        $this->writeLine(sprintf('Summary: synced=%d failed=%d', count($vars) - $failures, $failures));

        if ($failures === 0) {
            $this->writeLine('Ghostable 👻 deployed!');
        }

        return $failures > 0 ? Command::FAILURE : Command::SUCCESS;
    }
}
