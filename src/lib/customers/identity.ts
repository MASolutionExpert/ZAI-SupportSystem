import "server-only";

import { createHmac, scryptSync } from "crypto";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "@/lib/crypto";
import { getEnv } from "@/lib/env";

/**
 * Customer identity (Phase 4) — national ID (کد ملی) handling.
 *
 * Hard rules fixed in advance (DATABASE.md §6, SECURITY.md §4):
 *  - the raw value is NEVER a relational key, never in URLs/logs/APIs/error
 *    messages or operator-facing lists;
 *  - at rest it is app-level AES-256-GCM encrypted (enc.v1 envelope);
 *  - equality lookups use a keyed HMAC-SHA256 index column;
 *  - HMAC/encryption keys derive from APP_ENCRYPTION_KEY (fallback
 *    AUTH_SECRET) with domain-separated salts.
 */

const HMAC_SALT = "sd.national-id-hmac.v1";

let hmacKey: Buffer | null = null;

function getKeyMaterial(): Buffer {
  const env = getEnv();
  return Buffer.from(env.APP_ENCRYPTION_KEY || env.AUTH_SECRET, "utf8");
}

function getHmacKey(): Buffer {
  if (!hmacKey) {
    // Domain-separated subkey so the HMAC index cannot be confused with the
    // encryption key material (key-separation principle).
    hmacKey = scryptSync(getKeyMaterial(), HMAC_SALT, 32);
  }
  return hmacKey;
}

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → ASCII digits. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 0x30))
    .replace(/[\u0660-\u0669]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 0x30));
}

/**
 * Normalize a national-ID input: Unicode digits → ASCII, strip separators
 * (spaces, dashes, dots, ZWNJ), trim. Returns digits-only candidate.
 */
export function normalizeNationalId(input: string): string {
  return normalizeDigits(input)
    .replace(/[\s\u200c\u200f._-]/g, "")
    .trim();
}

/**
 * Validate an Iranian national ID (کد ملی) — server-side checksum:
 * 10 digits, not a single repeated digit, weighted mod-11 check digit.
 */
export function isValidNationalId(candidate: string): boolean {
  if (!/^\d{10}$/.test(candidate)) return false;
  if (/^(\d)\1{9}$/.test(candidate)) return false; // 0000000000-style rejects
  const digits = candidate.split("").map((c) => Number(c));
  const check = digits[9]!;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i]! * (10 - i);
  }
  const rem = sum % 11;
  return rem < 2 ? check === rem : check === 11 - rem;
}

/**
 * Full server-side validation + normalization of user-supplied national ID.
 * Returns null for invalid input (the caller maps this to a uniform error —
 * the raw value never appears in the error message).
 */
export function validateNationalId(raw: string): string | null {
  const candidate = normalizeNationalId(raw ?? "");
  return isValidNationalId(candidate) ? candidate : null;
}

/** Keyed HMAC-SHA256 lookup index (hex) — equality search without exposure. */
export function nationalIdHmac(normalizedId: string): string {
  return createHmac("sha256", getHmacKey()).update(normalizedId).digest("hex");
}

/** Encrypt the national ID at rest (enc.v1 envelope, AES-256-GCM). */
export function encryptNationalId(normalizedId: string): string {
  return encryptSecret(normalizedId);
}

/** Decrypt an enc.v1 envelope; null when tampered/unavailable. */
export function decryptNationalId(value: string): string | null {
  return isEncryptedSecret(value) ? decryptSecret(value) : null;
}

/**
 * Operator-facing masked form: shows the last 3 digits only (identification
 * aid, never the full value — SECURITY.md §4).
 */
export function maskNationalId(normalizedId: string): string {
  const tail = normalizedId.slice(-3);
  return `•••••••${tail}`;
}

/** Display-safe profile view — the full value NEVER leaves the server. */
export function customerPublicView(profile: {
  id: string;
  fullName: string;
  nationalIdEnc: string;
  status: string;
  createdAt: Date;
}): {
  id: string;
  fullName: string;
  maskedNationalId: string;
  status: string;
  createdAt: string;
} {
  const nid = decryptNationalId(profile.nationalIdEnc) ?? "";
  return {
    id: profile.id,
    fullName: profile.fullName,
    maskedNationalId: nid ? maskNationalId(nid) : "••••••••••",
    status: profile.status,
    createdAt: profile.createdAt.toISOString(),
  };
}
