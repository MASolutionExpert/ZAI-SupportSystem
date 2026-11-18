import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  departmentCreateSchema,
  departmentUpdateSchema,
} from "@/lib/validators";
import type { z } from "zod";

/**
 * Department management service — business rules + audit trail.
 * All mutations are audited (`department.*`) with the acting user attached.
 */

type Actor = { id: string; username: string };
type Meta = { ip?: string | null; userAgent?: string | null };

export type DepartmentRow = {
  id: string;
  name: string;
  description: string | null;
  iconKey: string;
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
  aiEnabled: boolean;
  welcomeMessage: string | null;
  memberCount: number;
  managerCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function listDepartments(): Promise<DepartmentRow[]> {
  const rows = await db.department.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: {
      memberships: { select: { isManager: true } },
    },
  });
  return rows.map(({ memberships, ...d }) => ({
    ...d,
    memberCount: memberships.length,
    managerCount: memberships.filter((m) => m.isManager).length,
  }));
}

export async function createDepartment(
  input: z.infer<typeof departmentCreateSchema>,
  actor: Actor,
  meta: Meta
) {
  const department = await db.department.create({ data: input });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "department.create",
    entityType: "department",
    entityId: department.id,
    metadata: { name: department.name, isActive: department.isActive },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return department;
}

export async function updateDepartment(
  id: string,
  input: z.infer<typeof departmentUpdateSchema>,
  actor: Actor,
  meta: Meta
) {
  const existing = await db.department.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "دپارتمان یافت نشد." };

  const department = await db.department.update({ where: { id }, data: input });

  const changed = Object.keys(input).filter((k) => {
    const before = (existing as unknown as Record<string, unknown>)[k];
    const after = (department as unknown as Record<string, unknown>)[k];
    return before !== after;
  });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "department.update",
    entityType: "department",
    entityId: department.id,
    metadata: { name: department.name, changed },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const, department };
}

export async function deleteDepartment(
  id: string,
  actor: Actor,
  meta: Meta
) {
  const existing = await db.department.findUnique({
    where: { id },
    include: { _count: { select: { memberships: true } } },
  });
  if (!existing) return { ok: false as const, error: "دپارتمان یافت نشد." };

  // Guard: departments carry tickets/files from later phases — deletion is
  // only possible while the department is completely unassigned.
  if (existing._count.memberships > 0) {
    return {
      ok: false as const,
      error:
        "این دپارتمان دارای اعضا است. ابتدا اعضا را خارج کنید یا دپارتمان را غیرفعال نمایید.",
    };
  }

  await db.department.delete({ where: { id } });

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "department.delete",
    entityType: "department",
    entityId: existing.id,
    metadata: { name: existing.name },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const };
}

export async function reorderDepartments(
  orderedIds: string[],
  actor: Actor,
  meta: Meta
) {
  const existing = await db.department.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((d) => d.id));

  if (orderedIds.length !== existingIds.size || orderedIds.some((id) => !existingIds.has(id))) {
    return { ok: false as const, error: "فهرست ترتیب با دپارتمان‌های موجود هم‌خوانی ندارد." };
  }

  await db.$transaction(
    orderedIds.map((id, index) =>
      db.department.update({ where: { id }, data: { displayOrder: index + 1 } })
    )
  );

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.username,
    action: "department.reorder",
    entityType: "department",
    metadata: { count: orderedIds.length },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ok: true as const };
}
