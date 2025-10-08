import keytar from "keytar";
import { randomBytes, b64, ub64 } from "./crypto.js";

const SERVICE = "ghostable-cli";

export type KeyBundle = {
  // master seed → derive ENC/HMAC per org/project/env via HKDF
  masterSeedB64: string;
  ed25519PrivB64: string;
  ed25519PubB64: string;
};

export async function loadOrCreateKeys(
  profile = "default",
): Promise<KeyBundle> {
  const existing = await keytar.getPassword(SERVICE, profile);
  if (existing) return JSON.parse(existing) as KeyBundle;

  const masterSeed = randomBytes(32);
  // Ed25519 keypair from seed — noble uses RFC8032; derive deterministically
  const edSeed = randomBytes(32);
  const pub = await (await import("@noble/ed25519")).getPublicKey(edSeed);
  const bundle: KeyBundle = {
    masterSeedB64: `b64:${b64(masterSeed)}`,
    ed25519PrivB64: `b64:${b64(edSeed)}`,
    ed25519PubB64: `b64:${b64(pub)}`,
  };
  await keytar.setPassword(SERVICE, profile, JSON.stringify(bundle));
  return bundle;
}

export function getPriv(bundle: KeyBundle): Uint8Array {
  return ub64(bundle.ed25519PrivB64);
}
export function getPub(bundle: KeyBundle): Uint8Array {
  return ub64(bundle.ed25519PubB64);
}
export function getSeed(bundle: KeyBundle): Uint8Array {
  return ub64(bundle.masterSeedB64);
}
