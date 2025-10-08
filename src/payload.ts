import { aeadEncrypt, b64, deriveKeys, edSign, hmacSHA256 } from "./crypto.js";

export type Claims = {
  hmac: string;
  validators: Record<string, any>;
};

export function buildClaims(hmac: string, validators: Record<string, any>): Claims {
  return { hmac, validators };
}

export async function buildUploadPayload(opts: {
  name: string;
  env: string;
  org: string;
  project: string;
  plaintext: string;            // e.g., APP_KEY value
  masterSeed: Uint8Array;       // from keychain
  edPriv: Uint8Array;           // ed25519 private key
  validators?: Record<string, any>;
  ifVersion?: number;           // ← optimistic concurrency guard (optional)
}) {
  const { name, env, org, project, plaintext, masterSeed, edPriv, ifVersion } = opts;

  // derive per-scope keys so HMAC equality doesn’t leak across orgs
  const { encKey, hmacKey } = deriveKeys(masterSeed, `${org}/${project}/${env}`);

  const aad = { org, project, env, name };
  const bundle = aeadEncrypt(encKey, new TextEncoder().encode(plaintext), aad);

  // HMAC for drift/equality detection
  const hmac = hmacSHA256(hmacKey, new TextEncoder().encode(plaintext));

  const claims = {
    hmac,
    validators: {
      non_empty: plaintext.length > 0,
      ...(opts.validators ?? {})
    }
  };

  // Body to be signed (no server-assigned fields here)
  const body: any = {
    name,
    env,
    ciphertext: bundle.ciphertext,
    nonce: bundle.nonce,
    alg: bundle.alg,
    aad: bundle.aad,
    claims
  };
  if (ifVersion !== undefined) body.if_version = ifVersion; // include only when present

  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const sig = await edSign(edPriv, bytes);

  return { ...body, client_sig: `b64:${b64(sig)}` };
}