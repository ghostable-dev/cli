import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { Listr } from "listr2";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import chalk from "chalk";

import { initSodium } from "../crypto.js";
import { loadOrCreateKeys } from "../keys.js";
import { buildUploadPayload } from "../payload.js";

import { config } from "../config/index.js";
import { SessionService } from "../services/SessionService.js";
import { GhostableClient } from "../services/GhostableClient.js";
import { Manifest } from "../support/Manifest.js";

type PushOptions = {
  api?: string;
  token?: string;
  file?: string;     // optional override; else .env.<env> or .env
  env?: string;      // optional; prompt if missing
  assumeYes?: boolean;
};

function readEnvFile(filePath: string): Record<string, string> {
  const raw = fs.readFileSync(filePath, "utf8");
  return dotenv.parse(raw);
}

function resolveEnvFile(envName: string | undefined, explicitPath?: string): string {
  if (explicitPath) return path.resolve(process.cwd(), explicitPath);
  if (envName) {
    const candidate = path.resolve(process.cwd(), `.env.${envName}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(process.cwd(), ".env");
}

export function registerEnvPushCommand(program: Command) {
  program
    .command("env:push")
    .description("Encrypt and push a local .env file to Ghostable (uses ghostable.yml)")
    .option("--file <PATH>", "Path to .env file (default: .env.<env> or .env)")
    .option("--env <ENV>", "Environment name (if omitted, select from manifest)")
    .option("-y, --assume-yes", "Skip confirmation prompts", false)
    .action(async (opts: PushOptions) => {
      // 1) Load manifest
      let projectId: string, projectName: string, manifestEnvs: string[];
      try {
        projectId = Manifest.id();
        projectName = Manifest.name();
        manifestEnvs = Manifest.environmentNames();
      } catch (e: any) {
        console.error(chalk.red(e?.message ?? String(e)));
        process.exit(1);
        return;
      }
      if (!manifestEnvs.length) {
        console.error(chalk.red("❌ No environments defined in ghostable.yml."));
        process.exit(1);
      }

      // 2) Pick env (flag → prompt)
      let envName = opts.env;
      if (!envName) {
        envName = await select({
          message: "Which environment would you like to push?",
          choices: manifestEnvs.sort().map((n) => ({ name: n, value: n })),
        });
      }

      // 3) Resolve token, and org from session if needed
      const sessionSvc = new SessionService();
      const sess = await sessionSvc.load();
      if (!sess?.accessToken) {
        console.error(chalk.red("❌ No API token. Run `ghostable login`."));
        process.exit(1);
      }
      let token = sess.accessToken;
      let orgId = sess.organizationId;

      // 4) Resolve .env file path
      const filePath = resolveEnvFile(envName!, opts.file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`❌ .env file not found at ${filePath}`));
        process.exit(1);
      }

      // 5) Read variables
      const envMap = readEnvFile(filePath);
      const entries = Object.entries(envMap);
      if (!entries.length) {
        console.log(chalk.yellow("⚠️  No variables found in the .env file."));
        return;
      }

      if (!opts.assumeYes) {
        console.log(
          chalk.cyan(
            `About to push ${entries.length} variables from ${chalk.bold(filePath)}\n` +
            `→ project ${chalk.bold(projectName)} (${projectId})\n` +
            (orgId ? `→ org ${chalk.bold(orgId)}\n` : "")
          )
        );
      }

      // 6) Prep crypto + client
      await initSodium(); // no-op with stablelib
      const keyBundle = await loadOrCreateKeys();
      const masterSeed = Buffer.from(keyBundle.masterSeedB64.replace(/^b64:/, ""), "base64");
      const edPriv     = Buffer.from(keyBundle.ed25519PrivB64.replace(/^b64:/, ""), "base64");

      const client = GhostableClient.unauthenticated(config.apiBase).withToken(token);

      // 7) Encrypt + push per variable
      const tasks = new Listr(
        entries.map(([name, value]) => ({
          title: `${name}`,
          task: async (_ctx, task) => {
            const validators: Record<string, any> = { non_empty: value.length > 0 };
            if (name === "APP_KEY") {
              validators.regex   = { id: "base64_44char_v1", ok: /^base64:/.test(value) && value.length >= 44 };
              validators.length  = value.length;
            }

            const payload = await buildUploadPayload({
              name,
              env: envName!,          // from manifest selection
              org: orgId ?? "",       // server can infer if token is org-scoped
              project: projectId,     // from manifest
              plaintext: value,
              masterSeed,
              edPriv,
              validators,
              // ifVersion?: number  // add later for optimistic concurrency
            });

            await client.uploadSecret(projectId, envName, payload);
            task.title = `${name}  ${chalk.green("✓")}`;
          },
        })),
        { concurrent: false, exitOnError: true }
      );

      try {
        await tasks.run();
        console.log(
          chalk.green(`\n✅ Pushed ${entries.length} variables to ${projectId}:${envName} (encrypted locally).`)
        );
      } catch (err: any) {
        console.log(err);
        console.error(chalk.red(`\n❌ env:push failed: ${err?.message ?? err}`));
        process.exit(1);
      }
    });
}