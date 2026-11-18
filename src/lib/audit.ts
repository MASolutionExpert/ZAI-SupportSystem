import { db } from "@/lib/db";

/**
 * Audit logging — every important administrative and security action must be
 * auditable (master spec section 15). Never store secrets or raw PII here.
 */

export type AuditActorType = "USER" | "SYSTEM" | "CUSTOMER";

export type AuditInput = {
  actorType?: AuditActorType;
  actorUserId?: string;
  actorLabel?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorType: input.actorType ?? "SYSTEM",
        actorUserId: input.actorUserId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (error) {
    // Audit failures must never break the main flow — log server-side.
    console.error("[audit] failed to persist audit record:", error);
  }
}

export type AuditQuery = {
  actions?: string[];
  actorUserId?: string;
  limit?: number;
  before?: Date;
};

export async function listAuditRecords(query: AuditQuery = {}) {
  return db.auditLog.findMany({
    where: {
      ...(query.actions?.length ? { action: { in: query.actions } } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.before ? { createdAt: { lt: query.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(query.limit ?? 50, 200),
  });
}

// ------------------------------------------------------------- viewer ----

export type AuditPageQuery = {
  /** Free-text substring match on the action key (case-sensitive). */
  action?: string;
  actorType?: "USER" | "SYSTEM" | "CUSTOMER";
  /** Substring match on the stored actor label (username snapshot). */
  actorLabel?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export type AuditPageRow = {
  id: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  actorLabel: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  actor: { name: string; username: string } | null;
};

export type AuditPageResult = {
  rows: AuditPageRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Paginated audit viewer query with actor-name join. Used by the
 * `admin.audit.view` UI; filters are conjunctive and all optional.
 */
export async function listAuditPage(query: AuditPageQuery = {}): Promise<AuditPageResult> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 25)), 100);

  const where = {
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" as const } } : {}),
    ...(query.actorType ? { actorType: query.actorType } : {}),
    ...(query.actorLabel ? { actorLabel: { contains: query.actorLabel, mode: "insensitive" as const } } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        actor: { select: { name: true, username: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}
