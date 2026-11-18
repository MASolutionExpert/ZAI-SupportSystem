import "server-only";

import { createHmac, scryptSync, timingSafeEqual } from "crypto";
import { getEnv } from "@/lib/env";

/**
 * Customer portal session (Phase 4) — short-lived, HMAC-signed cookie.
 *
 * Issued ONLY after OTP identity verification; grants access to the
 * customer's OWN tickets/history for a bounded window, after which the
 * customer must re-verify. The cookie value is:
 *
 *   base64url(JSON payload).HMAC-SHA256(payload, portal-session key)
 *
 * The signing key derives (scrypt, domain-separated salt) from
 * APP_ENCRYPTION_KEY / AUTH_SECRET — never stored in the DB.
 */

export const PORTAL_COOKIE_NAME = "sd_portal";
export const PORTAL_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const SIGN_SALT = "sd.portal-session.v1";

let signKey: Buffer | null = null;

function getSignKey(): Buffer {
  if (!signKey) {
    const env = getEnv();
    signKey = scryptSync(Buffer.from(env.APP_ENCRYPTION_KEY || env.AUTH_SECRET, "utf8"), SIGN_SALT, 32);
  }
  return signKey;
}

export type PortalPayload = {
  /** customer profile id */
  cid: string;
  /** issued-at (epoch ms) */
  iat: number;
  /** expiry (epoch ms) */
  exp: number;
};

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", getSignKey()).update(value).digest("base64url");
}

/** Create a signed portal session token for the given customer id. */
export function createPortalToken(customerId: string, ttlMs = PORTAL_SESSION_TTL_MS): string {
  const now = Date.now();
  const payload: PortalPayload = { cid: customerId, iat: now, exp: now + ttlMs };
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * Verify a portal session token; returns the payload when valid and
 * unexpired, otherwise null (never throws, never leaks the failure reason).
 */
export function verifyPortalToken(token: string | undefined | null): PortalPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PortalPayload;
    if (typeof payload.cid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Cookie options for the portal session — httpOnly (not readable from
 * client JS), same-site lax, secure outside development.
 */
export function portalCookieOptions(maxAgeSeconds: number) {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production" || env.FORCE_SECURE_COOKIES === "true",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
