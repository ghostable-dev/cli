<?php

namespace Ghostable\Support;

use Ghostable\Contracts\EnvBuilder;

final class ChildEnvBuilder implements EnvBuilder
{
    /** @var string[] */
    private array $protected = ['PATH', 'PWD', 'HOME', 'USER', 'SHELL', 'SYSTEMROOT', 'COMPOSER_HOME'];

    public function __construct(?array $protected = null)
    {
        if ($protected !== null) {
            $this->protected = $protected;
        }
    }

    /** {@inheritDoc} */
    public function build(array $vars, bool $protectSystem = true): array
    {
        // Start from current process env (left side wins on + operator)
        $env = $_SERVER + $_ENV;

        foreach ($vars as $k => $v) {
            $k = (string) $k;

            if ($v === null) {
                unset($env[$k]);

                continue;
            }

            if ($protectSystem && in_array($k, $this->protected, true)) {
                continue;
            }

            $env[$k] = (string) $v;
        }

        return $env;
    }
}
