# Ghostable CLI

**Ghostable** is a secure, Laravel-friendly platform for managing and sharing environment variables across projects and CI pipelines. This repository contains the CLI client used to interact with that platform.

Ghostable stores and organizes your `.env` variables, validates them, and integrates seamlessly into your development workflow—locally or in CI.

Read the [official documentation](https://docs.ghostable.dev) or try it out at [Ghostable.dev](https://ghostable.dev).

See [SECURITY.md](./SECURITY.md) for our security policy.

## Project creation payload

When `ghostable init` creates a new project it POSTs to `/organizations/{org_id}/projects` with a payload similar to:

```jsonc
{
    "name": "Example App",
    "deployment_provider": "laravel_forge",
    "stack": {
        "language": "php",
        "framework": "laravel",
        "platform": "laravel_forge",
    },
}
```

`stack` is optional and only set when the CLI collects the metadata. Each value uses the `ProjectStackTag` enum (see `src/entities/project/ProjectStack.ts`).
