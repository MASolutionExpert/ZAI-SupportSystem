import { NextRequest } from "next/server";
import { apiOk, apiError, requirePermission } from "@/lib/api";
import { listAuditPage } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit — paginated audit log viewer (admin.audit.view).
 * Query params (all optional): action, actorType, actorLabel, entityType,
 * entityId, from (ISO), to (ISO), page, pageSize.
 */

const ACTOR_TYPES = ["USER", "SYSTEM", "CUSTOMER"] as const;

function parseDate(value: string | null): { ok: true; date?: Date } | { ok: false } {
  if (!value) return { ok: true };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, date: d };
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission("admin.audit.view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;

  const actorTypeRaw = params.get("actorType");
  if (actorTypeRaw && !ACTOR_TYPES.includes(actorTypeRaw as (typeof ACTOR_TYPES)[number])) {
    return apiError("نوع عامل نامعتبر است.", 422, "VALIDATION_ERROR");
  }

  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));
  if (!from.ok || !to.ok) {
    return apiError("بازه زمانی نامعتبر است.", 422, "VALIDATION_ERROR");
  }

  const pageRaw = Number(params.get("page") ?? "1");
  const pageSizeRaw = Number(params.get("pageSize") ?? "25");
  if (!Number.isInteger(pageRaw) || pageRaw < 1 || pageRaw > 10_000) {
    return apiError("شماره صفحه نامعتبر است.", 422, "VALIDATION_ERROR");
  }
  if (!Number.isInteger(pageSizeRaw) || pageSizeRaw < 1 || pageSizeRaw > 100) {
    return apiError("اندازه صفحه باید عددی بین ۱ تا ۱۰۰ باشد.", 422, "VALIDATION_ERROR");
  }

  try {
    const result = await listAuditPage({
      action: params.get("action")?.slice(0, 80) ?? undefined,
      actorType: (actorTypeRaw as (typeof ACTOR_TYPES)[number]) || undefined,
      actorLabel: params.get("actorLabel")?.slice(0, 80) ?? undefined,
      entityType: params.get("entityType")?.slice(0, 60) ?? undefined,
      entityId: params.get("entityId")?.slice(0, 60) ?? undefined,
      from: from.date,
      to: to.date,
      page: pageRaw,
      pageSize: pageSizeRaw,
    });

    return apiOk({
      rows: result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actorType: row.actorType,
        actorUserId: row.actorUserId,
        actorLabel: row.actorLabel,
        actorName: row.actor?.name ?? null,
        actorUsername: row.actor?.username ?? null,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (error) {
    console.error("[api/admin/audit] failed:", error);
    return apiError("دریافت گزارش حسابرسی ناموفق بود.", 500, "AUDIT_LIST_FAILED");
  }
}
