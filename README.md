# Ghostable CLI
[![Total Downloads](http://poser.pugx.org/ghostable-dev/cli/downloads)](https://packagist.org/packages/ghostable-dev/cli)
[![Latest Stable Version](http://poser.pugx.org/ghostable-dev/cli/v)](https://packagist.org/packages/ghostable-dev/cli)
[![License](http://poser.pugx.org/ghostable-dev/cli/license)](https://packagist.org/packages/ghostable-dev/cli)
    
**Ghostable** is a secure, Laravel-friendly platform for managing and sharing environment variables across projects and CI pipelines. This repository contains the CLI client used to interact with that platform.

Ghostable stores and organizes your `.env` variables, validates them, and integrates seamlessly into your development workflow—locally or in CI.

Read the [official documentation](https://docs.ghostable.dev) or try it out at [Ghostable.dev](https://ghostable.dev).

## Forge Deployments

Use the `env:forge` command to push environment variables directly to a Laravel Forge site and optionally trigger a deployment:

```bash
ghostable env:forge --environment=production --server=123 --site=456 --token=FORGE_API_TOKEN --deploy
```

See [SECURITY.md](./SECURITY.md) for our security policy.
