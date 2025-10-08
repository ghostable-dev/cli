import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { config } from "../config/index.js";
import { b64, randomBytes } from "../crypto.js";
import { writeEnvFile, readEnvFileSafe } from "../support/env-files.js";
import {
  createGhostableClient,
  decryptProjection,
  resolveManifestContext,
  resolveToken,
} from "../support/deploy-helpers.js";

export function registerDeployForgeCommand(program: Command) {
  program
    .command("deploy:forge")
    .description("Pull, decrypt, write .env; optionally re-encrypt via Laravel's env:encrypt and store key in .env")
    .option("--api <URL>", "Ghostable API base", config.apiBase)
    .option("--env <ENV>", "Environment to deploy (default: pick from manifest)")
    .option("--token <TOKEN>", "Ghostable CI token (or env GHOSTABLE_CI_TOKEN)")
    .option("--encrypted", "Also produce an encrypted blob via php artisan env:encrypt", false)
    .option("--out <PATH>", "Where to write the encrypted blob (default: .env.<env>.encrypted)")
    .option("--only <KEY...>", "Limit to specific keys")
    .action(async (opts: {
      api?: string;
      env?: string;
      token?: string;
      encrypted?: boolean;
      out?: string;
      only?: string[];
    }) => {
      // 1) Resolve project/env context
      let context;
      try {
        context = resolveManifestContext(opts.env);
      } catch (error: any) {
        console.error(error?.message ?? error);
        process.exit(1);
      }
      const { projectId, projectName, envName } = context;

      // 2) Token + client
      let token: string;
      try {
        token = await resolveToken(opts.token);
      } catch (error: any) {
        console.error(error?.message ?? error);
        process.exit(1);
      }
      const client = createGhostableClient(token, opts.api ?? config.apiBase);

      // 3) Pull projection for this env
      const pullSpin = ora(`Pulling encrypted projection for ${projectName}:${envName}…`).start();
      let bundle: Awaited<ReturnType<typeof client.pull>>;
      try {
        bundle = await client.pull(projectId, envName, { includeMeta: true, includeVersions: true, only: opts.only });
        pullSpin.succeed("Projection fetched.");
      } catch (err:any) {
        pullSpin.fail("Failed to pull projection.");
        console.error(chalk.red(err?.message ?? err));
        process.exit(1);
      }
      if (!bundle.secrets.length) {
        console.log(chalk.yellow("No secrets returned; nothing to write."));
        return;
      }

      // 4) Decrypt + merge (child wins). We only have a single env in chain now.
      const { secrets, warnings } = await decryptProjection(bundle);
      for (const warning of warnings) {
        console.warn(chalk.yellow(`⚠️ ${warning}`));
      }

      const merged: Record<string, string> = {};
      for (const secret of secrets) {
        merged[secret.entry.name] = secret.value;
      }

      // 5) Write .env.<env>
      const envPath = path.resolve(process.cwd(), `.env.${envName}`);
      const previous = readEnvFileSafe(envPath);
      const combined = { ...previous, ...merged };
      writeEnvFile(envPath, combined);
      console.log(chalk.green(`✅ Wrote ${Object.keys(merged).length} keys → ${envPath}`));

      // 6) If --encrypted, generate base64 key, run php artisan env:encrypt, and persist key in .env.<env>
      if (opts.encrypted) {
        const phpOk = havePhpAndArtisan();
        if (!phpOk) {
          console.error(chalk.red("❌ Cannot find `php` or `artisan` in the current project. Run inside a Laravel app."));
          process.exit(1);
        }

        const envKeyB64 = `base64:${b64(randomBytes(32))}`;
        // ensure key is present in the plain .env file
        combined["LARAVEL_ENV_ENCRYPTION_KEY"] = envKeyB64;
        writeEnvFile(envPath, combined);
        console.log(chalk.green(`🔑 Set LARAVEL_ENV_ENCRYPTION_KEY in ${path.basename(envPath)}`));

        // Create encrypted blob using Laravel's own command to ensure format compatibility
        const encSpin = ora("Encrypting .env via php artisan env:encrypt…").start();

        // We will temporarily swap `.env` so artisan reads the desired file.
        const cwd = process.cwd();
        const dotEnv = path.join(cwd, ".env");
        const backup = path.join(cwd, ".env.__ghostable_backup__");
        const targetOut = path.resolve(cwd, opts.out ?? `.env.${envName}.encrypted`);

        try {
          // backup any existing .env
          let hadOriginal = false;
          if (fs.existsSync(dotEnv)) {
            fs.renameSync(dotEnv, backup);
            hadOriginal = true;
          }
          // copy .env.<env> → .env (so artisan reads it)
          fs.copyFileSync(envPath, dotEnv);

          // run php artisan env:encrypt --key="base64:..."
          const res = spawnSync("php", ["artisan", "env:encrypt", `--key=${envKeyB64}`], { stdio: "pipe" });
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

          encSpin.succeed(`Encrypted blob → ${path.relative(cwd, targetOut)}`);
        } finally {
          // restore original .env if it existed
          const existsBackup = fs.existsSync(backup);
          // remove temp .env
          if (fs.existsSync(dotEnv)) fs.unlinkSync(dotEnv);
          if (existsBackup) fs.renameSync(backup, dotEnv);
        }
      }

      console.log(chalk.green("Ghostable 👻 deployed (local)."));
    });
}

// helpers
function havePhpAndArtisan(): boolean {
  // php available?
  const php = spawnSync("php", ["-v"], { stdio: "ignore" });
  if (php.status !== 0) return false;
  // artisan file in cwd?
  return fs.existsSync(path.join(process.cwd(), "artisan"));
}