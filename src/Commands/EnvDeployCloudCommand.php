<?php

namespace Ghostable\Commands;

use Ghostable\Contracts\EnvEditor;
use Ghostable\Contracts\EnvRenderer;
use Ghostable\Helpers;
use GuzzleHttp\Exception\ClientException;

class EnvDeployCloudCommand extends EnvDeployCommand
{
    protected EnvRenderer $renderer;

    protected EnvEditor $editor;

    public function __construct()
    {
        $this->renderer = Helpers::app(EnvRenderer::class);

        $this->editor = Helpers::app(EnvEditor::class);

        parent::__construct();
    }

    protected function configure(): void
    {
        parent::configure();

        $this->setName('deploy:cloud')
            ->setDescription('Deploy Ghostable managed environment variables into Laravel Cloud.');
    }

    public function handle(): ?int
    {
        $token = $this->option('token') ?? $this->config->getCiToken();

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
            $plan = $this->editor->plan('local', $vars);
            $this->printPlan($plan);

            return Command::SUCCESS;
        }

        $this->editor->merge('local', $vars);
        $this->writeLine('Ghostable 👻 deployed!');

        return Command::SUCCESS;
    }
}
