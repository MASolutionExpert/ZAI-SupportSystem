import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  createSession,
  revokeAllSessionsExcept,
  resolveSession,
} from "@/lib/auth/session";
import {
  hashPassword,
  validatePasswordStrength,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/throttle";
import { audit } from "@/lib/audit";

/**
 * Authentication service — login (with throttling + account lockout),
 * logout and password change. All security events are audited.
 */

export type LoginResult =
  | { ok: true; mustChangePassword: boolean; user: { id: string; username: string; name: string; roleKey: string } }
  | { ok: false; error: string; retryAfterSeconds?: number };

const GLOBAL_LOGIN_WINDOW_MS = 60_000;
const GLOBAL_LOGIN_LIMIT = 10;

export async function login(
  username: string,
  password: string,
  meta: { ip?: string | null; userAgent?: string | null }
): Promise<LoginResult> {
  const env = getEnv();

  // Per-IP throttle — protects against credential stuffing bursts.
  const ipLimited = rateLimit(`login:ip:${meta.ip ?? "unknown"}`, {
    limit: GLOBAL_LOGIN_LIMIT,
    windowMs: GLOBAL_LOGIN_WINDOW_MS,
  });
  if (!ipLimited.allowed) {
    return {
      ok: false,
      error: "تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.",
      retryAfterSeconds: ipLimited.retryAfterSeconds,
    };
  }

  const uname = username.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { username: uname } });

  if (!user) {
    // Equalize timing for missing users.
    await verifyDummyPassword();
    await audit({
      actorType: "SYSTEM",
      action: "auth.login.failed",
      entityType: "user",
      metadata: { reason: "unknown_username" },
      ip: meta.ip ?? undefined,
      userAgent: meta.userAgent ?? undefined,
    });
    return { ok: false, error: "نام کاربری یا رمز عبور نادرست است." };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const retryAfterSeconds = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 1000
    );
    return {
      ok: false,
      error:
        "این حساب به دلیل تلاش‌های ناموفق موقتاً قفل شده است. بعداً دوباره تلاش کنید.",
      retryAfterSeconds,
    };
  }

  if (user.status === "SUSPENDED" || user.status === "INACTIVE") {
    await audit({
      actorType: "SYSTEM",
      action: "auth.login.failed",
      actorUserId: user.id,
      actorLabel: user.username,
      entityType: "user",
      entityId: user.id,
      metadata: { reason: "inactive_account" },
      ip: meta.ip ?? undefined,
      userAgent: meta.userAgent ?? undefined,
    });
    return { ok: false, error: "این حساب کاربری غیرفعال است." };
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);

  if (!passwordValid) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= env.LOGIN_MAX_ATTEMPTS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60 * 1000)
          : null,
      },
    });
    await audit({
      actorType: "SYSTEM",
      action: shouldLock ? "auth.login.locked" : "auth.login.failed",
      actorUserId: user.id,
      actorLabel: user.username,
      entityType: "user",
      entityId: user.id,
      metadata: { attempts },
      ip: meta.ip ?? undefined,
      userAgent: meta.userAgent ?? undefined,
    });
    return {
      ok: false,
      error: shouldLock
        ? "حساب شما به دلیل تلاش‌های ناموفق موقتاً قفل شد."
        : "نام کاربری یا رمز عبور نادرست است.",
    };
  }

  // Success — reset counters, stamp login time, create session.
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await createSession(user.id, meta);

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "auth.login.success",
    entityType: "user",
    entityId: user.id,
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return {
    ok: true,
    mustChangePassword: user.mustChangePassword,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      roleKey: user.roleKey,
    },
  };
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: string };

export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
  meta: { ip?: string | null; userAgent?: string | null }
): Promise<ChangePasswordResult> {
  const resolved = await resolveSession();
  if (!resolved) {
    return { ok: false, error: "نشست معتبر یافت نشد." };
  }

  const user = await db.user.findUnique({
    where: { id: resolved.user.id },
  });
  if (!user) {
    return { ok: false, error: "کاربر یافت نشد." };
  }

  const currentValid = await verifyPassword(
    currentPassword,
    user.passwordHash
  );
  if (!currentValid) {
    await audit({
      actorType: "USER",
      actorUserId: user.id,
      actorLabel: user.username,
      action: "auth.password.change_failed",
      entityType: "user",
      entityId: user.id,
      metadata: { reason: "wrong_current_password" },
      ip: meta.ip ?? undefined,
      userAgent: meta.userAgent ?? undefined,
    });
    return { ok: false, error: "رمز عبور فعلی نادرست است." };
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    return { ok: false, error: strength.reason ?? "رمز عبور ضعیف است." };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  // Revoke every other session (keep the current one).
  await revokeAllSessionsExcept(user.id, resolved.sessionId);

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "auth.password.changed",
    entityType: "user",
    entityId: user.id,
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true };
}
