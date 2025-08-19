# Ghostable CLI

**Ghostable** is a secure, Laravel-friendly platform for managing and sharing environment variables across teams, projects and CI pipelines. This repository contains the CLI client used to interact with that platform.

Ghostable stores and organizes your `.env` variables, validates them, and integrates seamlessly into your development workflow—locally or in CI.

Read the [official documentation](https://docs.ghostable.dev) or try it out at [Ghostable.dev](https://ghostable.dev).

## API Versioning

The Ghostable API is versioned. The CLI targets `v1` by default and prefixes all requests with `/api/v1`.

If you need to communicate with a newer API version you can override this default using the `--api-version` flag:

```bash
ghostable --api-version=v2 <command>
```

Alternatively, set the `GHOSTABLE_API_VERSION` environment variable or configure `api_version` in `~/.ghostable/config.json`.

See [SECURITY.md](./SECURITY.md) for our security policy.
