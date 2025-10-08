import { Command } from "commander";
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
import { log } from "../support/logger.js";

export function registerDeployCloudCommand(program: Command) {
  program
    .command("deploy:cloud")
    .description("Deploy Ghostable managed environment variables for Laravel Cloud.")
    .option("--token <TOKEN>", "Ghostable CI token (or env GHOSTABLE_CI_TOKEN)")
    .option("--out <PATH>", "Where to write the encrypted blob (default: .env.<env>.encrypted)")
    .option("--only <KEY...>", "Limit to specific keys")
    .action(async (opts: {
      token?: string;
      encrypted?: boolean;
      out?: string;
      only?: string[];
    }) => {
      
      // 1) Token + client
      let token: string;
      try {
        token = await resolveToken(opts.token);
      } catch (error: any) {
        log.error(error?.message ?? error);
        process.exit(1);
      }
      const client = createGhostableClient(token);

      // 2) Fetch projection for this env (derived from token)
      const deploySpin = ora(`Fetching encrypted projection…`).start();
      let bundle: Awaited<ReturnType<typeof client.deploy>>;
      try {
        bundle = await client.deploy({ includeMeta: true, includeVersions: true, only: opts.only });
        deploySpin.succeed("Projection fetched.");
      } catch (err:any) {
        deploySpin.fail("Failed to fetch projection.");
        log.error(err?.message ?? err);
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

      log.ok("Ghostable 👻 deployed (local).");
    });
}