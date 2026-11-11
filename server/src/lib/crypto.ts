// Token encryption — AES-256-GCM, for the Google refresh token stored
// in gmail_tokens. The key is the Netlify env var TOKEN_ENCRYPTION_KEY
// (a 64-hex-character random value, 32 bytes). The plaintext token is
// never stored, never logged, and never sent to the client. A missing
// or wrong-length key throws, so token storage fails loudly instead of
// silently storing an unusable value.
//
// Format: base64( iv (12 bytes) || authTag (16 bytes) || ciphertext ).
// Node's built-in crypto only — no new dependency.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(keyHex: string): Buffer {
  const key = Buffer.from(keyHex.trim(), "hex");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a 64-hex-character (32-byte) key.",
    );
  }
  return key;
}

export function encryptToken(plaintext: string, keyHex: string): string {
  const key = keyBytes(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptToken(blob: string, keyHex: string): string {
  const key = keyBytes(keyHex);
  const raw = Buffer.from(blob, "base64");
  if (raw.length < 28) throw new Error("Stored token is not a valid encrypted value.");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf-8");
}
