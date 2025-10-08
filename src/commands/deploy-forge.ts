import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { Manifest } from "../support/Manifest.js";
import { SessionService } from "../services/SessionService.js";
import { GhostableClient } from "../services/GhostableClient.js";
import { config } from "../config/index.js";

import { initSodium, deriveKeys, aeadDecrypt, scopeFromAAD, b64, randomBytes, hmacSHA256 } from "../crypto.js";
import { loadOrCreateKeys } from "../keys.js";

// tiny dotenv io
function writeEnvFile(filePath: string, vars: Record<string,string>) {
  const content = Object.keys(vars)
    .sort((a,b)=>a.localeCompare(b))
    .map(k => `${k}=${vars[k]}`)
    .join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf8");
}
function readEnvFile(filePath: string): Record<string,string> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const out: Record<string,string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0,i)] = line.slice(i+1);
  }
  return out;
}

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
      let projectId: string, projectName: string, envNames: string[];
      try {
        projectId = Manifest.id();
        projectName = Manifest.name();
        envNames = Manifest.environmentNames();
      } catch (e:any) {
        console.error(chalk.red(e?.message ?? "Missing ghostable.yml manifest"));
        process.exit(1);
      }
      if (!envNames.length) {
        console.error(chalk.red("❌ No environments defined in ghostable.yml"));
        process.exit(1);
      }
      const envName = opts.env ?? envNames[0];

      // 2) Token + client
      const token = opts.token || process.env.GHOSTABLE_CI_TOKEN || (await new SessionService().load())?.accessToken;
      if (!token) {
        console.error(chalk.red("❌ No API token. Use --token or set GHOSTABLE_CI_TOKEN or run `ghostable login`."));
        process.exit(1);
      }
      const client = GhostableClient.unauthenticated(opts.api ?? config.apiBase).withToken(token);

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
      await initSodium();
      const { masterSeedB64 } = await loadOrCreateKeys();
      const masterSeed = Buffer.from(masterSeedB64.replace(/^b64:/, ""), "base64");

      const merged: Record<string,string> = {};
      for (const entry of bundle.secrets) {
        const scope = scopeFromAAD(entry.aad as any); // org/project/env used at push time
        const { encKey, hmacKey } = deriveKeys(masterSeed, scope);
        try {
          const pt = aeadDecrypt(encKey, {
            alg: entry.alg,
            nonce: entry.nonce,
            ciphertext: entry.ciphertext,
            aad: entry.aad as any,
          });
          const value = new TextDecoder().decode(pt);

          // Optional integrity check (matches server claims)
          const digest = hmacSHA256(hmacKey, new TextEncoder().encode(value));
          if (entry.claims?.hmac && digest !== entry.claims.hmac) {
            console.warn(chalk.yellow(`⚠️ HMAC mismatch for ${entry.name}; skipping`));
            continue;
          }

          merged[entry.name] = value;
        } catch {
          console.warn(chalk.yellow(`⚠️ Could not decrypt ${entry.name}; skipping`));
          continue;
        }
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
function readEnvFileSafe(p: string) {
  try { return readEnvFile(p); } catch { return {}; }
}