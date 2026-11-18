import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { invalidateUserPermissions } from "@/lib/rbac/service";
import {
  hashPassword,
  validatePasswordStrength,
} from "@/lib/auth/password";
import { revokeAllSessions, revokeAllSessionsExcept } from "@/lib/auth/session";
import {
  membershipsPutSchema,
  overridesPutSchema,
  resetPasswordSchema,
  userCreateSchema,
  userUpdateSchema,
} from "@/lib/validators";
import type { z } from "zod";

/**
 * Operator/user management service — accounts, activation/suspension,
 * credential resets, department memberships and per-user permission overrides.
 *
 * Hard protection rules (server-enforced):
 *  - An actor cannot change their own role or account status (lockout guard).
 *  - The system must always keep at least one ACTIVE SUPER_ADMIN.
 *  - Password plaintext is never stored or audited.
 */

type Actor = { id: string; username: string };
type Meta = { ip?: string | null; userAgent?: string | null };

export type UserRow = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roleKey: string;
  roleName: string;
  status: string;
  isAvailable: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  activeSessions: number;
  memberships: { departmentId: string; departmentName: string; isManager: boolean }[];
};

const USER_SELECT = {
  id: true,
  username: true,
  name: true,
  email: true,
  roleKey: true,
  status: true,
  isAvailable: true,
  mustChangePassword: true,
  lastLoginAt: true,
  role: { select: { name: true } },
  memberships: {
    select: { departmentId: true, isManager: true, department: { select: { name: true } } },
  },
  sessions: {
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  },
} as const;

type UserWithRelations = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roleKey: string;
  status: string;
  isAvailable: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  role: { name: string };
  memberships: { departmentId: string; isManager: boolean; department: { name: string } }[];
  sessions: { id: string }[];
};

function toRow(u: UserWithRelations): UserRow {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    roleKey: u.roleKey,
    roleName: u.role?.name ?? u.roleKey,
    status: u.status,
    isAvailable: u.isAvailable,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    activeSessions: u.sessions.length,
    memberships: u.memberships.map((m) => ({
      departmentId: m.departmentId,
      departmentName: m.department.name,
      isManager: m.isManager,
    })),
  };
}

export async function listUsers(): Promise<UserRow[]> {
  const users = await db.user.findMany({
    orderBy: [{ username: "asc" }],
    select: USER_SELECT,
  });
  return users.map(toRow);
}

async function countOtherActiveSuperAdmins(excludeUserId: string): Promise<number> {
  return db.user.count({
    where: {
      roleKey: "SUPER_ADMIN",
      status: "ACTIVE",
      id: { not: excludeUserId },
    },
  });
}

export async function createUser(
  input: z.infer<typeof userCreateSchema>,
  actor: Actor,
  meta: Meta
) {
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) return { ok: false as const, error: strength.reason ?? "رمز عبور ضعیف است." };

  const role = await db.role.findUnique({ where: { key: input.roleKey } });
  if (!role) return { ok: false as const, error: "نقش انتخاب‌شده وجود ندارد." };

  const duplicate = await db.user.findUnique({ where: { username: input.username } });
  if (duplicate) return { ok: false as const, error: "این نام کاربری قبلاً ثبت شده است." };

  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({
    data: {
      username: input.username,
      name: input.name,
      email: input.email ?? null,
      passwordHash,
      roleKey: input.roleKey,
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "user.create",
    entityType: "user",
    entityId: user.id,
    metadata: { username: user.username, roleKey: user.roleKey },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const, userId: user.id };
}

export async function updateUser(
  targetId: string,
  input: z.infer<typeof userUpdateSchema>,
  actor: Actor,
  meta: Meta,
  actorSessionId?: string
) {
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false as const, error: "کاربر یافت نشد." };

  // Self-protection: changing own role/status can lock the operator out.
  if (targetId === actor.id && (input.roleKey !== undefined || input.status !== undefined)) {
    return {
      ok: false as const,
      error: "تغییر نقش یا وضعیت حساب خودتان مجاز نیست.",
    };
  }

  if (input.roleKey !== undefined) {
    const role = await db.role.findUnique({ where: { key: input.roleKey } });
    if (!role) return { ok: false as const, error: "نقش انتخاب‌شده وجود ندارد." };

    if (
      target.roleKey === "SUPER_ADMIN" &&
      input.roleKey !== "SUPER_ADMIN" &&
      target.status === "ACTIVE"
    ) {
      const others = await countOtherActiveSuperAdmins(targetId);
      if (others === 0) {
        return {
          ok: false as const,
          error: "حداقل یک مدیر ارشد فعال باید همیشه وجود داشته باشد.",
        };
      }
    }
  }

  if (input.status !== undefined && input.status !== "ACTIVE" && target.roleKey === "SUPER_ADMIN") {
    const others = await countOtherActiveSuperAdmins(targetId);
    if (others === 0) {
      return {
        ok: false as const,
        error: "غیرفعال‌سازی آخرین مدیر ارشد فعال مجاز نیست.",
      };
    }
  }

  const wasActive = target.status === "ACTIVE";
  const user = await db.user.update({ where: { id: targetId }, data: input });

  // Status change → invalidate all existing sessions of the account.
  if (input.status !== undefined && input.status !== "ACTIVE" && wasActive) {
    await revokeAllSessions(targetId);
  }
  if (input.roleKey !== undefined && input.roleKey !== target.roleKey) {
    invalidateUserPermissions(targetId);
  }

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "user.update",
    entityType: "user",
    entityId: targetId,
    metadata: {
      username: target.username,
      changed: Object.keys(input),
      ...(input.roleKey ? { roleKey: input.roleKey } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  void actorSessionId;
  return { ok: true as const, user: { id: user.id, username: user.username } };
}

export async function resetUserPassword(
  targetId: string,
  input: z.infer<typeof resetPasswordSchema>,
  actor: Actor,
  meta: Meta
) {
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false as const, error: "کاربر یافت نشد." };

  let plain: string;
  if (input.generate) {
    plain = generateStrongPassword();
  } else {
    plain = input.password!;
    const strength = validatePasswordStrength(plain);
    if (!strength.ok) return { ok: false as const, error: strength.reason ?? "رمز عبور ضعیف است." };
  }

  const passwordHash = await hashPassword(plain);
  await db.user.update({
    where: { id: targetId },
    data: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null },
  });

  await revokeAllSessions(targetId);
  invalidateUserPermissions(targetId);

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "user.password.reset",
    entityType: "user",
    entityId: targetId,
    metadata: { username: target.username, generated: input.generate === true, sessionsRevoked: true },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const, temporaryPassword: plain };
}

/** Random password satisfying the policy (>=12 chars, upper+lower+digit). */
function generateStrongPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (chars: string) =>
    chars[Math.floor(Math.random() * chars.length)]!;
  // 16 chars: guaranteed one of each class, then shuffled positions.
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

export async function setUserMemberships(
  targetId: string,
  input: z.infer<typeof membershipsPutSchema>,
  actor: Actor,
  meta: Meta
) {
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false as const, error: "کاربر یافت نشد." };

  const deptIds = [...new Set(input.memberships.map((m) => m.departmentId))];
  if (deptIds.length !== input.memberships.length) {
    return { ok: false as const, error: "هر دپارتمان فقط یک‌بار می‌تواند انتخاب شود." };
  }

  const existingDepts = await db.department.findMany({
    where: { id: { in: deptIds } },
    select: { id: true },
  });
  if (existingDepts.length !== deptIds.length) {
    return { ok: false as const, error: "یک یا چند دپارتمان انتخابی وجود ندارد." };
  }

  await db.$transaction([
    db.departmentMembership.deleteMany({ where: { userId: targetId } }),
    ...input.memberships.map((m) =>
      db.departmentMembership.create({
        data: { userId: targetId, departmentId: m.departmentId, isManager: m.isManager },
      })
    ),
  ]);

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "user.memberships.set",
    entityType: "user",
    entityId: targetId,
    metadata: {
      username: target.username,
      departments: input.memberships.map((m) => ({
        departmentId: m.departmentId,
        isManager: m.isManager,
      })),
    },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const };
}

export async function setUserOverrides(
  targetId: string,
  input: z.infer<typeof overridesPutSchema>,
  actor: Actor,
  meta: Meta
) {
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false as const, error: "کاربر یافت نشد." };

  const seen = new Set<string>();
  for (const o of input.overrides) {
    if (seen.has(o.permissionKey)) {
      return { ok: false as const, error: "هر مجوز فقط یک استثنا می‌تواند داشته باشد." };
    }
    seen.add(o.permissionKey);
  }

  await db.$transaction([
    db.userPermissionOverride.deleteMany({ where: { userId: targetId } }),
    ...input.overrides.map((o) =>
      db.userPermissionOverride.create({
        data: {
          userId: targetId,
          permissionKey: o.permissionKey,
          effect: o.effect,
          note: o.note ?? null,
        },
      })
    ),
  ]);

  invalidateUserPermissions(targetId);

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "user.overrides.set",
    entityType: "user",
    entityId: targetId,
    metadata: {
      username: target.username,
      overrides: input.overrides.map((o) => ({ key: o.permissionKey, effect: o.effect })),
    },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const };
}

/** Workload/activity snapshot of one user (real data; tickets arrive Phase 4). */
export async function getUserActivity(targetId: string) {
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: USER_SELECT,
  });
  if (!target) return null;

  const recentAudits = await db.auditLog.findMany({
    where: { actorUserId: targetId },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, action: true, createdAt: true, entityType: true, entityId: true },
  });

  return { user: toRow(target), recentAudits };
}

export async function changeOwnAvailability(
  userId: string,
  isAvailable: boolean,
  actor: Actor,
  meta: Meta
) {
  const user = await db.user.update({
    where: { id: userId },
    data: { isAvailable },
    select: { id: true, username: true, isAvailable: true },
  });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: isAvailable ? "staff.availability.on" : "staff.availability.off",
    entityType: "user",
    entityId: userId,
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  void user;
  return { ok: true as const };
}

export async function revokeAllSessionsOf(targetId: string, actor: Actor, meta: Meta) {
  const count = await revokeAllSessionsExcept(targetId);
  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "user.sessions.revoke",
    entityType: "user",
    entityId: targetId,
    metadata: { revoked: count },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });
  return count;
}
