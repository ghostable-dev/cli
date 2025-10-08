import { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import chalk from "chalk";
import { Manifest } from "../support/Manifest.js";
import keytar from "keytar";
import { log } from "../support/logger.js";

export function registerKeysSetCommand(program: Command) {
  program
    .command("keys:set")
    .description("Store a base64 environment key for local decrypt/pull use")
    .action(async () => {
      // 1) Load project and envs from manifest
      let projectId: string, envNames: string[];
      try {
        projectId = Manifest.id();
        envNames = Manifest.environmentNames();
      } catch (e: any) {
        log.error(e?.message ?? "Missing ghostable.yml manifest.");
        process.exit(1);
      }
      if (!envNames.length) {
        log.error("❌ No environments found in ghostable.yml.");
        process.exit(1);
      }

      // 2) Choose env
      const envName = await select({
        message: "Which environment key do you want to set?",
        choices: envNames.sort().map((n) => ({ name: n, value: n })),
      });

      // 3) Ask for key
      const rawKey = await input({
        message: `Paste the base64 key for ${envName}:`,
        validate: (v) => /^base64:[A-Za-z0-9+/=]+$/.test(v.trim()) || "Expected format: base64:...",
      });
      const key = rawKey.trim();

      // 4) Save in keychain
      const SERVICE = "ghostable-cli-env-key";
      const ACCOUNT = `${projectId}:${envName}`;
      await keytar.setPassword(SERVICE, ACCOUNT, key);

      log.line();
      log.ok(`✅ Stored key for ${envName}`);
      log.text(chalk.dim(`Keychain service: ${SERVICE}`));
    });
}