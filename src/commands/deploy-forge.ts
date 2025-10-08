import { Command } from "commander";
import ora from "ora";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { b64, randomBytes } from "../crypto.js";
import { writeEnvFile, readEnvFileSafe } from "../support/env-files.js";
import {
  createGhostableClient,
  decryptProjection,
  resolveToken,
} from "../support/deploy-helpers.js";
import { log } from "../support/logger.js";
import { toErrorMessage } from "../support/errors.js";
import type { ProjectionBundle } from "../services/GhostableClient.js";

export function registerDeployForgeCommand(program: Command) {
  program
    .command("deploy:forge")
    .description(
      "Deploy Ghostable managed environment variables for Laravel Forge.",
    )
    .option("--token <TOKEN>", "Ghostable CI token (or env GHOSTABLE_CI_TOKEN)")
    .option(
      "--encrypted",
      "Also produce an encrypted blob via php artisan env:encrypt",
      false,
    )
    .option(
      "--out <PATH>",
      "Where to write the encrypted blob (default: .env.<env>.encrypted)",
    )
    .option("--only <KEY...>", "Limit to specific keys")
    .action(
      async (opts: {
        token?: string;
        encrypted?: boolean;
        out?: string;
        only?: string[];
      }) => {
        // 1) Token + client
        let token: string;
        try {
          token = await resolveToken(opts.token);
        } catch (error) {
          log.error(toErrorMessage(error));
          process.exit(1);
        }
        const client = createGhostableClient(token);

        // 2) Fetch projection for this env (derived from token)
        const deploySpin = ora(`Fetching encrypted projection…`).start();
        let bundle: ProjectionBundle;
        try {
          bundle = await client.deploy({
            includeMeta: true,
            includeVersions: true,
            only: opts.only,
          });
          deploySpin.succeed("Projection fetched.");
        } catch (error) {
          deploySpin.fail("Failed to fetch projection.");
          log.error(toErrorMessage(error));
          process.exit(1);
        }

        if (!bundle.secrets.length) {
          log.warn("No secrets returned; nothing to write.");
          return;
        }

        // 3) Decrypt + merge (child wins). We only have a single env in chain now.
        const { secrets, warnings } = await decryptProjection(bundle);
        for (const warning of warnings) {
          log.warn(`⚠️ ${warning}`);
        }

        const merged: Record<string, string> = {};
        for (const secret of secrets) {
          merged[secret.entry.name] = secret.value;
        }

        // 4) Write .env.<env>
        const envPath = path.resolve(process.cwd(), `.env`);
        const previous = readEnvFileSafe(envPath);
        const combined = { ...previous, ...merged };
        writeEnvFile(envPath, combined);
        log.ok(`✅ Wrote ${Object.keys(merged).length} keys → ${envPath}`);

        // 5) If --encrypted, generate base64 key, run php artisan env:encrypt, and persist key in .env.<env>
        if (opts.encrypted) {
          const phpOk = havePhpAndArtisan();
          if (!phpOk) {
            log.error(
              "❌ Cannot find `php` or `artisan` in the current project. Run inside a Laravel app.",
            );
            process.exit(1);
          }

          const envKeyB64 = `base64:${b64(randomBytes(32))}`;
          // ensure key is present in the plain .env file
          combined["LARAVEL_ENV_ENCRYPTION_KEY"] = envKeyB64;
          writeEnvFile(envPath, combined);
          log.ok(
            `🔑 Set LARAVEL_ENV_ENCRYPTION_KEY in ${path.basename(envPath)}`,
          );

          // Create encrypted blob using Laravel's own command to ensure format compatibility
          const encSpin = ora(
            "Encrypting .env via php artisan env:encrypt…",
          ).start();

          // We will temporarily swap `.env` so artisan reads the desired file.
          const cwd = process.cwd();
          const dotEnv = path.join(cwd, ".env");
          const backup = path.join(cwd, ".env.__ghostable_backup__");
          const targetOut = path.resolve(cwd, opts.out ?? `.env.encrypted`);

          let hadOriginal = false;
          try {
            // backup any existing .env
            if (fs.existsSync(dotEnv)) {
              fs.renameSync(dotEnv, backup);
              hadOriginal = true;
            }
            // copy .env.<env> → .env (so artisan reads it)
            fs.copyFileSync(envPath, dotEnv);

            // run php artisan env:encrypt --key="base64:..."
            const res = spawnSync(
              "php",
              ["artisan", "env:encrypt", `--key=${envKeyB64}`],
              { stdio: "pipe" },
            );
            if (res.status !== 0) {
              encSpin.fail("php artisan env:encrypt failed.");
              process.stderr.write(res.stderr?.toString() ?? "");
              throw new Error("env:encrypt failed");
            }

            // artisan should produce .env.encrypted in cwd; move it
            const produced = path.join(cwd, ".env.encrypted");
            if (!fs.existsSync(produced)) {
              encSpin.fail("Expected .env.encrypted not found.");
              throw new Error("missing .env.encrypted");
            }
            fs.renameSync(produced, targetOut);

            encSpin.succeed(
              `Encrypted blob → ${path.relative(cwd, targetOut)}`,
            );
          } finally {
            // restore original .env if it existed
            // remove temp .env
            if (fs.existsSync(dotEnv)) fs.unlinkSync(dotEnv);
            if (hadOriginal && fs.existsSync(backup)) {
              fs.renameSync(backup, dotEnv);
            }
          }
        }

        log.ok("Ghostable 👻 deployed (local).");
      },
    );
}

// helpers
function havePhpAndArtisan(): boolean {
  // php available?
  const php = spawnSync("php", ["-v"], { stdio: "ignore" });
  if (php.status !== 0) return false;
  // artisan file in cwd?
  return fs.existsSync(path.join(process.cwd(), "artisan"));
}
