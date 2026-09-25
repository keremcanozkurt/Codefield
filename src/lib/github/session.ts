import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Cookie values are sealed with AES-256-GCM: encrypted so the browser never
// holds a readable GitHub token, and authenticated so a modified cookie is
// rejected rather than decrypted into something else. The cookie name is
// bound in as additional data, so one sealed cookie cannot be replayed under
// another name.
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const MIN_SECRET_LENGTH = 32;

export function deriveSessionKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "codefield github session", 32));
}

export function seal(key: Buffer, purpose: string, payload: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url")}`;
}

// Returns null for anything that was not sealed with this key and purpose.
export function unseal(key: Buffer, purpose: string, value: string): unknown {
  if (!value.startsWith(`${VERSION}.`)) return null;
  const bytes = Buffer.from(value.slice(VERSION.length + 1), "base64url");
  if (bytes.length < IV_BYTES + TAG_BYTES) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}
