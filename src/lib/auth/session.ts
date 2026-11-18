import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getEnv, isProduction } from "@/lib/env";

/**
 * Server-side, revocable sessions.
 *
 *  - Token: 32 random bytes (base64url) — only its SHA-256 hash is stored.
 *  - Cookie: httpOnly, SameSite=Lax, Secure (auto-detected / forced).
 *  - Expiry fixed at creation (SESSION_TTL_HOURS); revoked sessions are
 *    rejected immediately (supports logout + credential-change revocation).
 */

export const SESSION_COOKIE = "sd_session";

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  roleKey: string;
  status: string;
  isAvailable: boolean;
  mustChangePassword: boolean;
};

type ResolvedSession = {
  sessionId: string;
  user: SessionUser;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function secureCookie(): boolean {
  if (getEnv().FORCE_SECURE_COOKIES === "true") return true;
  return isProduction();
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null }
): Promise<void> {
  const env = getEnv();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000
  );

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: env.SESSION_TTL_HOURS * 60 * 60,
  });
}

/**
 * Resolve the current session from the request cookies and load the user.
 * Expired sessions are cleaned up lazily; revoked sessions are rejected.
 */
export async function resolveSession(): Promise<ResolvedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;

  const now = new Date();
  if (session.revokedAt || session.expiresAt <= now) return null;

  if (session.user.status !== "ACTIVE") return null;

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      username: session.user.username,
      name: session.user.name,
      roleKey: session.user.roleKey,
      status: session.user.status,
      isAvailable: session.user.isAvailable,
      mustChangePassword: session.user.mustChangePassword,
    },
  };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const resolved = await resolveSession();
  return resolved?.user ?? null;
}

/** Revoke one session (used for logout of the current token). */
export async function revokeCurrentSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;

  const result = await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });

  cookieStore.delete(SESSION_COOKIE);
  return result.count > 0;
}

/** Revoke every session of a user except one (password change, lockout...). */
export async function revokeAllSessionsExcept(
  userId: string,
  keepSessionId?: string
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Revoke every session of a user (suspension, credential reset...). */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function countActiveSessions(): Promise<number> {
  return db.session.count({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
  });
}

/** housekeeping — remove expired sessions (safe to call opportunistically). */
export async function pruneExpiredSessions(): Promise<void> {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
