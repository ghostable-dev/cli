# Ghostable CLI

**Ghostable** is a secure, Laravel-friendly platform for managing and sharing environment variables across projects and CI pipelines. This repository contains the CLI client used to interact with that platform.

Ghostable stores and organizes your `.env` variables, validates them, and integrates seamlessly into your development workflow—locally or in CI.

Read the [official documentation](https://docs.ghostable.dev) or try it out at [Ghostable.dev](https://ghostable.dev).

See [SECURITY.md](./SECURITY.md) for our security policy.

### Ignored Keys

You can specify keys per environment in `ghostable.yml → environments.<env>.ignore` that Ghostable will skip during push, pull, and diff. These keys are never synced or overwritten.

```yaml
environments:
  production:
    type: production
    ignore:
      - LOCAL_DB_URL
      - APP_DEBUG
```

The defaults `GHOSTABLE_CI_TOKEN` and `GHOSTABLE_MASTER_SEED` are always ignored across every environment, and any per-environment list extends that fixed set.
