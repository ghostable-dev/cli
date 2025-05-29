<?php

namespace Ghostable\Env;

enum EnvLineType: string
{
    case ENV = 'env';
    case INVALID = 'invalid';
}
