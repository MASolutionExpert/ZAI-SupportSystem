import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import { getEnv } from "@/lib/env";

/**
 * App-level secret encryption (AES-256-GCM).
 *
 * Used for credentials that must never be stored or returned in plaintext:
 * AI provider API keys now (Phase 3), customer PII from Phase 4.
 * Key material: APP_ENCRYPTION_KEY when set, otherwise AUTH_SECRET — both
 * server-only values (see src/lib/env.ts). Ciphertext format:
 *
 *   enc.v1:<iv b64>:<authTag b64>:<ciphertext b64>
 */

const CIPHER = "aes-256-gcm";
const PREFIX = "enc.v1";
const SALT = "sd.app-encryption.v1";

let derivedKey: Buffer | null = null;

function getKey(): Buffer {
  if (derivedKey) return derivedKey;
  const env = getEnv();
  const material = env.APP_ENCRYPTION_KEY || env.AUTH_SECRET;
  // scrypt with a fixed application salt — the input material is already a
  // server-only secret; the salt only makes the derivation domain-separated.
  derivedKey = scryptSync(material, SALT, 32);
  return derivedKey;
}

/** Encrypt a plaintext secret. Returns the enc.v1 envelope string. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** Decrypt an enc.v1 envelope. Returns null when the value is not encrypted or tampered. */
export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const data = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv(CIPHER, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** True when the value carries the enc.v1 envelope prefix. */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith(`${PREFIX}:`);
}

/**
 * Masked display form of a secret: keeps a short recognizable tail only,
 * e.g. "sk-••••••9f2c". Never returns the plaintext.
 */
export function maskSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 6) return "•".repeat(8);
  return `${trimmed.slice(0, 3)}${"•".repeat(8)}${trimmed.slice(-4)}`;
}

/** SHA-256 hex digest — used for query digests, checksums, token hashing. */
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Constant-time string comparison (thin wrapper, equalizes on length). */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing flat, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
