import { Command } from "commander";
import ora from "ora";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

import { writeEnvFile, readEnvFileSafe } from "../support/env-files.js";
import {
  createGhostableClient,
  decryptProjection,
  resolveToken,
} from "../support/deploy-helpers.js";
import { log } from "../support/logger.js";
import { toErrorMessage } from "../support/errors.js";
import type { ProjectionBundle } from "../services/GhostableClient.js";

export function registerDeployVaporCommand(program: Command) {
  program
    .command("deploy:vapor")
    .description(
      "Deploy Ghostable managed environment variables for Laravel Vapor.",
    )
    .option("--token <TOKEN>", "Ghostable CI token (or env GHOSTABLE_CI_TOKEN)")
    .option("--vapor-env <ENV>", "Target Vapor environment")
    .option("--only <KEY...>", "Limit to specific keys")
    .action(
      async (opts: { token?: string; vaporEnv?: string; only?: string[] }) => {
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
          log.warn("No secrets returned; nothing to deploy.");
          return;
        }

        const { secrets, warnings } = await decryptProjection(bundle);
        for (const warning of warnings) {
          log.warn(`⚠️ ${warning}`);
        }

        if (!secrets.length) {
          log.warn("No decryptable secrets; nothing to deploy.");
          return;
        }

        const vaporEnv = (opts.vaporEnv ?? "").trim();
        if (!vaporEnv) {
          log.error(
            "❌ The --vapor-env option is required when deploying to Vapor.",
          );
          process.exit(1);
        }

        if (!binaryExists("vapor")) {
          log.error("❌ vapor CLI not found on PATH");
          process.exit(1);
        }

        const standardVars: Record<string, string> = {};
        const secretVars: Record<string, string> = {};

        for (const secret of secrets) {
          if (secret.entry.meta?.is_vapor_secret) {
            secretVars[secret.entry.name] = secret.value;
          } else {
            standardVars[secret.entry.name] = secret.value;
          }
        }

        try {
          await deployStandardVariables(vaporEnv, standardVars);
        } catch (error) {
          log.error(toErrorMessage(error));
          process.exit(1);
        }

        try {
          await deploySecretVariables(vaporEnv, secretVars);
        } catch (error) {
          log.error(toErrorMessage(error));
          process.exit(1);
        }

        log.ok(`Vapor environment "${vaporEnv}" updated.`);
      },
    );
}

async function deployStandardVariables(
  vaporEnv: string,
  variables: Record<string, string>,
): Promise<void> {
  const count = Object.keys(variables).length;
  log.info(
    `Deploying (${count}) standard variables to Vapor env "${vaporEnv}"`,
  );

  if (!count) {
    log.warn("No standard variables to deploy.");
    return;
  }

  log.info(`Pulling existing environment "${vaporEnv}" from Vapor`);
  const pull = runVaporCommand(["env:pull", vaporEnv]);
  ensureSuccessfulVaporProcess(pull, `pull environment "${vaporEnv}"`);

  const envPath = path.resolve(process.cwd(), `.env.${vaporEnv}`);
  const existing = readEnvFileSafe(envPath);
  const merged = { ...existing, ...variables };
  writeEnvFile(envPath, merged);

  log.info(`Pushing updated environment "${vaporEnv}" to Vapor`);
  const push = runVaporCommand(["env:push", vaporEnv]);
  ensureSuccessfulVaporProcess(push, `push environment "${vaporEnv}"`);
}

async function deploySecretVariables(
  vaporEnv: string,
  variables: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(variables);
  log.info(
    `Deploying (${entries.length}) secret variables to Vapor env "${vaporEnv}"`,
  );

  if (!entries.length) {
    log.warn("No secret variables to deploy.");
    return;
  }

  let failures = 0;
  for (const [key, value] of entries) {
    let filePath: string | undefined;
    try {
      filePath = await createSecretTempFile(value);
      const result = runVaporCommand([
        "secret",
        vaporEnv,
        `--name=${key}`,
        "--file",
        filePath,
      ]);

      if (result.status === 0) {
        log.ok(`[OK]   ${key}`);
      } else {
        failures++;
        const message = extractProcessError(result);
        log.error(`[ERR]  ${key} → ${message}`);
      }
    } catch (error) {
      failures++;
      log.error(`[ERR]  ${key} → ${toErrorMessage(error)}`);
    } finally {
      if (filePath) {
        safeUnlink(filePath);
      }
    }
  }

  if (failures > 0) {
    throw new Error(
      `Vapor secret deployment completed with ${failures} failure(s).`,
    );
  }

  log.ok("Vapor secret deployment completed successfully.");
}

function createSecretTempFile(value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = os.tmpdir();
    const name = `ghostable-secret-${crypto.randomBytes(6).toString("hex")}`;
    const filePath = path.join(dir, name);

    try {
      fs.writeFileSync(filePath, value, {
        encoding: "utf8",
        mode: 0o600,
        flag: "w",
      });
      fs.chmodSync(filePath, 0o600);
      resolve(filePath);
    } catch {
      safeUnlink(filePath);
      reject(new Error("Failed to write secret to temp file."));
    }
  });
}

function runVaporCommand(args: string[], timeoutSeconds = 120) {
  const result = spawnSync("vapor", args, {
    stdio: "pipe",
    encoding: "utf8",
    timeout: timeoutSeconds * 1000,
  });
  return result;
}

function ensureSuccessfulVaporProcess(
  result: ReturnType<typeof runVaporCommand>,
  action: string,
): void {
  if (result.status === 0) {
    return;
  }

  const message = extractProcessError(result);
  throw new Error(`Failed to ${action} using vapor CLI: ${message}`);
}

type SpawnError = Error & { code?: string };

function extractProcessError(
  result: ReturnType<typeof runVaporCommand>,
): string {
  if (result.error) {
    const err = result.error as SpawnError;
    if (err.code === "ETIMEDOUT") {
      return "process timed out";
    }
    return err.message;
  }

  const stderr = result.stderr?.toString().trim();
  if (stderr) return stderr;

  const stdout = result.stdout?.toString().trim();
  if (stdout) return stdout;

  return "unknown error";
}

function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore unlink failures
  }
}

function binaryExists(name: string): boolean {
  const paths = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT?.split(";") ?? [".exe", ".bat", ".cmd"])
      : [""];

  for (const base of paths) {
    for (const ext of extensions) {
      const candidate = path.join(base, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}
