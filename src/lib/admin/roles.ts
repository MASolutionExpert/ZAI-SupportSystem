import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { invalidateUserPermissions } from "@/lib/rbac/service";
import { ALL_PERMISSION_KEYS } from "@/lib/rbac/permissions";
import { roleCreateSchema, roleUpdateSchema } from "@/lib/validators";
import type { z } from "zod";

/**
 * Role & binding management service.
 *
 * Protections (server-enforced):
 *  - The three system roles (isSystem) cannot be renamed or deleted.
 *  - SUPER_ADMIN bindings are locked to the full catalog (re-synced by
 *    bootstrap); they are never editable from the API.
 *  - A role can be deleted only when no user is bound to it.
 *  - Reserved keys cannot be reused by custom roles.
 */

type Actor = { id: string; username: string };
type Meta = { ip?: string | null; userAgent?: string | null };

const RESERVED_ROLE_KEYS = ["SUPER_ADMIN", "OPERATOR", "FILE_MANAGER"];

export type RoleRow = {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionKeys: string[];
  createdAt: Date;
  updatedAt: Date;
};

export async function listRoles(): Promise<RoleRow[]> {
  const roles = await db.role.findMany({
    orderBy: [{ isSystem: "desc" }, { key: "asc" }],
    include: {
      _count: { select: { users: true } },
      permissions: { select: { permissionKey: true } },
    },
  });
  return roles.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    userCount: r._count.users,
    permissionKeys: r.permissions.map((p) => p.permissionKey),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createRole(
  input: z.infer<typeof roleCreateSchema>,
  actor: Actor,
  meta: Meta
) {
  if (RESERVED_ROLE_KEYS.includes(input.key)) {
    return { ok: false as const, error: "این کلید نقش برای نقش‌های سیستمی رزرو شده است." };
  }

  const duplicate = await db.role.findUnique({ where: { key: input.key } });
  if (duplicate) return { ok: false as const, error: "نقشی با این کلید وجود دارد." };

  const role = await db.role.create({
    data: {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      isSystem: false,
    },
  });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "role.create",
    entityType: "role",
    entityId: role.key,
    metadata: { key: role.key, name: role.name },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const, roleKey: role.key };
}

export async function updateRole(
  key: string,
  input: z.infer<typeof roleUpdateSchema>,
  actor: Actor,
  meta: Meta
) {
  const role = await db.role.findUnique({ where: { key } });
  if (!role) return { ok: false as const, error: "نقش یافت نشد." };
  if (role.isSystem) {
    return { ok: false as const, error: "نقش‌های سیستمی قابل ویرایش نیستند." };
  }

  const updated = await db.role.update({
    where: { key },
    data: { name: input.name ?? role.name, description: input.description ?? role.description },
  });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "role.update",
    entityType: "role",
    entityId: key,
    metadata: { key, name: updated.name },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const };
}

export async function deleteRole(key: string, actor: Actor, meta: Meta) {
  const role = await db.role.findUnique({
    where: { key },
    include: { _count: { select: { users: true } } },
  });
  if (!role) return { ok: false as const, error: "نقش یافت نشد." };
  if (role.isSystem) {
    return { ok: false as const, error: "نقش‌های سیستمی قابل حذف نیستند." };
  }
  if (role._count.users > 0) {
    return {
      ok: false as const,
      error: "ابتدا کاربران این نقش را به نقش دیگری منتقل کنید.",
    };
  }

  await db.role.delete({ where: { key } });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "role.delete",
    entityType: "role",
    entityId: key,
    metadata: { key, name: role.name },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const };
}

export async function setRoleBindings(
  key: string,
  permissionKeys: string[],
  actor: Actor,
  meta: Meta
) {
  const role = await db.role.findUnique({ where: { key } });
  if (!role) return { ok: false as const, error: "نقش یافت نشد." };

  if (key === "SUPER_ADMIN") {
    return {
      ok: false as const,
      error: "مجوزهای مدیر ارشد سامانه همیشه کامل است و قابل تغییر نیست.",
    };
  }

  const uniqueKeys = [...new Set(permissionKeys)];

  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleKey: key } }),
    ...uniqueKeys.map((permissionKey) =>
      db.rolePermission.create({ data: { roleKey: key, permissionKey } })
    ),
  ]);

  // Every user of this role may now have a different effective set.
  invalidateUserPermissions();

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "role.bindings.set",
    entityType: "role",
    entityId: key,
    metadata: { key, count: uniqueKeys.length, permissions: uniqueKeys },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const, count: uniqueKeys.length };
}

/** Guard helper for UI copy — SUPER_ADMIN bindings must equal full catalog. */
export const SUPER_ADMIN_REQUIRED_KEYS = ALL_PERMISSION_KEYS;
