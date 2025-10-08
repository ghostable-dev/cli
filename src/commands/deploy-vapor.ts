import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

import { config } from "../config/index.js";
import { writeEnvFile, readEnvFileSafe } from "../support/env-files.js";
import {
  createGhostableClient,
  decryptProjection,
  resolveManifestContext,
  resolveToken,
} from "../support/deploy-helpers.js";

export function registerDeployVaporCommand(program: Command) {
  program
    .command("deploy:vapor")
    .description("Deploy Ghostable environment variables and secrets to a Laravel Vapor environment.")
    .option("--api <URL>", "Ghostable API base", config.apiBase)
    .option("--env <ENV>", "Environment to deploy (default: pick from manifest)")
    .option("--token <TOKEN>", "Ghostable CI token (or env GHOSTABLE_CI_TOKEN)")
    .option("--vapor-env <ENV>", "Target Vapor environment")
    .option("--only <KEY...>", "Limit to specific keys")
    .action(async (opts: {
      api?: string;
      env?: string;
      token?: string;
      vaporEnv?: string;
      only?: string[];
    }) => {
      // Resolve manifest context
      let context;
      try {
        context = resolveManifestContext(opts.env);
      } catch (error: any) {
        console.error(error?.message ?? error);
        process.exit(1);
      }
      const { projectId, projectName, envName } = context;

      // Resolve API token
      let token: string;
      try {
        token = await resolveToken(opts.token);
      } catch (error: any) {
        console.error(error?.message ?? error);
        process.exit(1);
      }
      const client = createGhostableClient(token, opts.api ?? config.apiBase);

      // Pull projection from Ghostable
      const pullSpin = ora(`Pulling encrypted projection for ${projectName}:${envName}…`).start();
      let bundle: Awaited<ReturnType<typeof client.pull>>;
      try {
        bundle = await client.pull(projectId, envName, {
          includeMeta: true,
          includeVersions: true,
          only: opts.only,
        });
        pullSpin.succeed("Projection fetched.");
      } catch (error: any) {
        pullSpin.fail("Failed to pull projection.");
        console.error(chalk.red(error?.message ?? error));
        process.exit(1);
      }

      if (!bundle.secrets.length) {
        console.log(chalk.yellow("No secrets returned; nothing to deploy."));
        return;
      }

      const { secrets, warnings } = await decryptProjection(bundle);
      for (const warning of warnings) {
        console.warn(chalk.yellow(`⚠️ ${warning}`));
      }

      if (!secrets.length) {
        console.log(chalk.yellow("No decryptable secrets; nothing to deploy."));
        return;
      }

      const vaporEnv = (opts.vaporEnv ?? "").trim();
      if (!vaporEnv) {
        console.error(chalk.red("❌ The --vapor-env option is required when deploying to Vapor."));
        process.exit(1);
      }

      if (!binaryExists("vapor")) {
        console.error(chalk.red("❌ vapor CLI not found on PATH"));
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
      } catch (error: any) {
        console.error(chalk.red(error?.message ?? error));
        process.exit(1);
      }

      try {
        await deploySecretVariables(vaporEnv, secretVars);
      } catch (error: any) {
        console.error(chalk.red(error?.message ?? error));
        process.exit(1);
      }

      console.log(chalk.green(`Vapor environment "${vaporEnv}" updated.`));
    });
}

async function deployStandardVariables(vaporEnv: string, variables: Record<string, string>): Promise<void> {
  const count = Object.keys(variables).length;
  console.log(
    chalk.cyan(`Deploying (${count}) standard variables to Vapor env "${vaporEnv}"`)
  );

  if (!count) {
    console.log(chalk.yellow("No standard variables to deploy."));
    return;
  }

  console.log(chalk.cyan(`Pulling existing environment "${vaporEnv}" from Vapor`));
  const pull = runVaporCommand(["env:pull", vaporEnv]);
  ensureSuccessfulVaporProcess(pull, `pull environment "${vaporEnv}"`);

  const envPath = path.resolve(process.cwd(), `.env.${vaporEnv}`);
  const existing = readEnvFileSafe(envPath);
  const merged = { ...existing, ...variables };
  writeEnvFile(envPath, merged);

  console.log(chalk.cyan(`Pushing updated environment "${vaporEnv}" to Vapor`));
  const push = runVaporCommand(["env:push", vaporEnv]);
  ensureSuccessfulVaporProcess(push, `push environment "${vaporEnv}"`);
}

async function deploySecretVariables(vaporEnv: string, variables: Record<string, string>): Promise<void> {
  const entries = Object.entries(variables);
  console.log(
    chalk.cyan(
      `Deploying (${entries.length}) secret variables to Vapor env "${vaporEnv}"`
    )
  );

  if (!entries.length) {
    console.log(chalk.yellow("No secret variables to deploy."));
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
        console.log(chalk.green(`[OK]   ${key}`));
      } else {
        failures++;
        const message = extractProcessError(result);
        console.log(chalk.red(`[ERR]  ${key} → ${message}`));
      }
    } catch (error: any) {
      failures++;
      console.log(chalk.red(`[ERR]  ${key} → ${error?.message ?? error}`));
    } finally {
      if (filePath) {
        safeUnlink(filePath);
      }
    }
  }

  if (failures > 0) {
    throw new Error(`Vapor secret deployment completed with ${failures} failure(s).`);
  }

  console.log(chalk.green("Vapor secret deployment completed successfully."));
}

function createSecretTempFile(value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = os.tmpdir();
    const name = `ghostable-secret-${crypto.randomBytes(6).toString("hex")}`;
    const filePath = path.join(dir, name);

    try {
      fs.writeFileSync(filePath, value, { encoding: "utf8", mode: 0o600, flag: "w" });
      fs.chmodSync(filePath, 0o600);
      resolve(filePath);
    } catch (error) {
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
  action: string
): void {
  if (result.status === 0) {
    return;
  }

  const message = extractProcessError(result);
  throw new Error(`Failed to ${action} using vapor CLI: ${message}`);
}

function extractProcessError(result: ReturnType<typeof runVaporCommand>): string {
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
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
  const extensions = process.platform === "win32"
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
