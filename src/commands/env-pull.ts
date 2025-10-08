import { Command } from "commander";
import { select } from "@inquirer/prompts";
import fs from "node:fs";
import path from "node:path";

import { Manifest } from "../support/Manifest.js";
import { config } from "../config/index.js";
import { SessionService } from "../services/SessionService.js";
import {
  GhostableClient,
  ProjectionBundle,
  ProjectionEntry,
} from "../services/GhostableClient.js";
import { initSodium, deriveKeys, aeadDecrypt } from "../crypto.js";
import { loadOrCreateKeys } from "../keys.js";
import { log } from "../support/logger.js";

type PullOptions = {
  api?: string;
  token?: string;
  env?: string;
  file?: string; // output path; default .env.<env> or .env
  only?: string[]; // repeatable: --only KEY --only OTHER
  includeMeta?: boolean; // include meta flags in projection (not required for decrypt)
  dryRun?: boolean; // don't write file; just show summary
};

function resolveOutputPath(
  envName: string | undefined,
  explicit?: string,
): string {
  if (explicit) return path.resolve(process.cwd(), explicit);
  if (envName) return path.resolve(process.cwd(), `.env.${envName}`);
  return path.resolve(process.cwd(), ".env");
}

function lineForDotenv(name: string, value: string, commented = false): string {
  const safe = value.includes("\n") ? JSON.stringify(value) : value;
  return commented ? `# ${name}=${safe}` : `${name}=${safe}`;
}

export function registerEnvPullCommand(program: Command) {
  program
    .command("env:pull")
    .description(
      "Pull, decrypt, merge, and write a local .env for the selected environment (zero-knowledge)",
    )
    .option(
      "--env <ENV>",
      "Environment name (if omitted, select from manifest)",
    )
    .option("--file <PATH>", "Output file (default: .env.<env> or .env)")
    .option("--api <URL>", "Ghostable API base", config.apiBase)
    .option(
      "--token <TOKEN>",
      "API token (or stored session / GHOSTABLE_TOKEN)",
    )
    .option("--only <KEY...>", "Only include these keys")
    .option("--include-meta", "Include meta flags in projection", false)
    .option("--dry-run", "Do not write file; just report", false)
    .action(async (opts: PullOptions) => {
      // 1) Load manifest (project + envs)
      let projectId: string, projectName: string, envNames: string[];
      try {
        projectId = Manifest.id();
        projectName = Manifest.name();
        envNames = Manifest.environmentNames();
      } catch (e: any) {
        log.error(e?.message ?? String(e));
        process.exit(1);
        return;
      }
      if (!envNames.length) {
        log.error("❌ No environments defined in ghostable.yml.");
        process.exit(1);
      }

      // 2) Pick env (flag → prompt)
      let envName = opts.env;
      if (!envName) {
        envName = await select({
          message: "Which environment would you like to pull?",
          choices: envNames.sort().map((n) => ({ name: n, value: n })),
        });
      }

      // 3) Resolve token + org from session if needed
      const apiBase = opts.api ?? config.apiBase;
      let token = opts.token || process.env.GHOSTABLE_TOKEN || "";
      let orgId: string | undefined;

      if (!token) {
        const sessionSvc = new SessionService();
        const sess = await sessionSvc.load();
        if (!sess?.accessToken) {
          log.error(
            "❌ No API token. Run `ghostable login` or pass --token / set GHOSTABLE_TOKEN.",
          );
          process.exit(1);
        }
        token = sess.accessToken;
        orgId = sess.organizationId;
      } else {
        const sess = await new SessionService().load();
        orgId = sess?.organizationId;
      }

      // 4) Fetch projection bundle
      const client = GhostableClient.unauthenticated(apiBase).withToken(token);
      const bundle: ProjectionBundle = await client.pull(projectId, envName!, {
        includeMeta: !!opts.includeMeta,
        includeVersions: true,
        only: opts.only,
      });

      // 5) Prepare crypto
      await initSodium(); // no-op with stablelib; safe to keep
      const keyBundle = await loadOrCreateKeys();
      const masterSeed = Buffer.from(
        keyBundle.masterSeedB64.replace(/^b64:/, ""),
        "base64",
      );

      // 6) Decrypt layer-by-layer and merge (parent → ... → child; child wins)
      // Build order of envs from chain, then apply entries in that order
      const chainOrder = bundle.chain; // e.g., ["production","staging","local"]
      const byEnv = new Map<string, ProjectionEntry[]>();
      for (const entry of bundle.secrets) {
        if (!byEnv.has(entry.env)) byEnv.set(entry.env, []);
        byEnv.get(entry.env)!.push(entry);
      }

      const merged: Record<string, string> = {};
      const commentFlags: Record<string, boolean> = {}; // for is_commented when available

      for (const layer of chainOrder) {
        const entries = byEnv.get(layer) || [];
        for (const entry of entries) {
          // Derive enc key for this entry
          const scope = `${orgId ?? ""}/${projectId}/${layer}`;
          const { encKey } = deriveKeys(masterSeed, scope);
          const plaintext = aeadDecrypt(encKey, {
            alg: entry.alg,
            nonce: entry.nonce,
            ciphertext: entry.ciphertext,
            aad: entry.aad as any,
          });
          const value = new TextDecoder().decode(plaintext);

          // Apply merge (child overrides parent)
          merged[entry.name] = value;

          // Track comment flag if meta is included
          const isCommented = (entry.meta?.is_commented ?? false) as boolean;
          commentFlags[entry.name] = isCommented;
        }
      }

      // 7) Render dotenv
      const lines = Object.keys(merged)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => lineForDotenv(k, merged[k], commentFlags[k]));

      const outputPath = resolveOutputPath(envName!, opts.file);
      const content = lines.join("\n") + "\n";

      if (opts.dryRun) {
        log.info(
          `Dry run: would write ${Object.keys(merged).length} keys to ${outputPath}`,
        );
        process.exit(0);
      }

      fs.writeFileSync(outputPath, content, "utf8");

      log.ok(
        `✅ Wrote ${Object.keys(merged).length} keys to ${outputPath} (decrypted & merged locally for ${projectName}:${envName}).`,
      );
    });
}
