import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { Manifest } from "./Manifest.js";
import { SessionService } from "../services/SessionService.js";
import {
  GhostableClient,
  type ProjectionBundle,
  type ProjectionEntry,
} from "../services/GhostableClient.js";
import { config } from "../config/index.js";
import {
  initSodium,
  deriveKeys,
  aeadDecrypt,
  scopeFromAAD,
  hmacSHA256,
} from "../crypto.js";
import { loadOrCreateKeys } from "../keys.js";

type ManifestContext = {
  projectId: string;
  projectName: string;
  envName: string;
  envNames: string[];
};

type DecryptedSecret = {
  entry: ProjectionEntry;
  value: string;
};

type DecryptionResult = {
  secrets: DecryptedSecret[];
  warnings: string[];
};

export async function resolveManifestContext(
  requestedEnv?: string,
): Promise<ManifestContext> {
  let projectId: string;
  let projectName: string;
  let envNames: string[];

  try {
    projectId = Manifest.id();
    projectName = Manifest.name();
    envNames = Manifest.environmentNames();
  } catch (error: any) {
    const message = error?.message ?? "Missing ghostable.yml manifest";
    throw new Error(chalk.red(message));
  }

  if (!envNames.length) {
    throw new Error(chalk.red("❌ No environments defined in ghostable.yml"));
  }

  let envName = requestedEnv?.trim();

  if (envName) {
    if (!envNames.includes(envName)) {
      throw new Error(
        chalk.red(
          `❌ Environment "${envName}" not found in ghostable.yml. Available: ${envNames
            .slice()
            .sort()
            .join(", ")}`,
        ),
      );
    }
  } else {
    envName = await select({
      message: "Which environment would you like to deploy?",
      choices: envNames
        .slice()
        .sort()
        .map((name) => ({ name, value: name })),
    });
  }

  return { projectId, projectName, envName, envNames };
}

export async function resolveToken(explicitToken?: string): Promise<string> {
  const token =
    explicitToken ||
    process.env.GHOSTABLE_CI_TOKEN ||
    (await new SessionService().load())?.accessToken;

  if (!token) {
    throw new Error(
      chalk.red(
        "❌ No API token. Use --token or set GHOSTABLE_CI_TOKEN or run `ghostable login`.",
      ),
    );
  }

  return token;
}

export function createGhostableClient(
  token: string,
  apiBase?: string,
): GhostableClient {
  return GhostableClient.unauthenticated(apiBase ?? config.apiBase).withToken(
    token,
  );
}

export async function decryptProjection(
  bundle: ProjectionBundle,
): Promise<DecryptionResult> {
  await initSodium();
  const { masterSeedB64 } = await loadOrCreateKeys();
  const masterSeed = Buffer.from(masterSeedB64.replace(/^b64:/, ""), "base64");

  const secrets: DecryptedSecret[] = [];
  const warnings: string[] = [];

  for (const entry of bundle.secrets) {
    const scope = scopeFromAAD(entry.aad as any);
    const { encKey, hmacKey } = deriveKeys(masterSeed, scope);

    try {
      const plaintext = aeadDecrypt(encKey, {
        alg: entry.alg,
        nonce: entry.nonce,
        ciphertext: entry.ciphertext,
        aad: entry.aad as any,
      });

      const value = new TextDecoder().decode(plaintext);

      if (entry.claims?.hmac) {
        const digest = hmacSHA256(hmacKey, new TextEncoder().encode(value));
        if (digest !== entry.claims.hmac) {
          warnings.push(`HMAC mismatch for ${entry.name}; skipping`);
          continue;
        }
      }

      secrets.push({ entry, value });
    } catch {
      warnings.push(`Could not decrypt ${entry.name}; skipping`);
    }
  }

  return { secrets, warnings };
}

export type { ManifestContext, DecryptedSecret, DecryptionResult };
