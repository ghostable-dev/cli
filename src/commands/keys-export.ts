// src/commands/keys-export.ts
import { Command } from "commander";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { Manifest } from "../support/Manifest.js";
import { loadOrCreateKeys } from "../keys.js";
import { deriveKeys, b64 } from "../crypto.js";
import { SessionService } from "../services/SessionService.js";
import { log } from "../support/logger.js";
import { toErrorMessage } from "../support/errors.js";

export function registerKeysExportCommand(program: Command) {
  program
    .command("keys:export")
    .description(
      "Export a base64 environment encryption key (pick from manifest)",
    )
    .action(async () => {
      // 1) Read manifest (project + envs)
      let projectId: string, envNames: string[];
      try {
        projectId = Manifest.id();
        envNames = Manifest.environmentNames();
      } catch (error) {
        log.error(toErrorMessage(error) || "Missing ghostable.yml manifest.");
        process.exit(1);
        return;
      }
      if (!envNames.length) {
        log.error("❌ No environments found in ghostable.yml.");
        process.exit(1);
      }

      // 2) Pick env from list
      const envName = await select({
        message: "Which environment key would you like to export?",
        choices: envNames.sort().map((n) => ({ name: n, value: n })),
      });

      // 3) Get org from session
      const sess = await new SessionService().load();
      const orgId = sess?.organizationId;
      if (!orgId) {
        log.error("❌ No organization linked. Run `ghostable login` first.");
        process.exit(1);
      }

      // 4) Derive the per-env key and print it
      const { masterSeedB64 } = await loadOrCreateKeys();
      const masterSeed = Buffer.from(
        masterSeedB64.replace(/^b64:/, ""),
        "base64",
      );
      const scope = `${orgId}/${projectId}/${envName}`;
      const { encKey } = deriveKeys(masterSeed, scope);

      const exportKey = `base64:${b64(encKey)}`;
      log.line();
      log.text(chalk.bold.cyan(`🔑  Environment key for ${envName}`));
      log.ok(exportKey);
      log.line();
      log.text(
        chalk.dim(
          `Copy this and store it in a password manager.\n` +
            `Anyone with this key can decrypt ${envName} for project ${projectId}.`,
        ),
      );
    });
}
