import { NextRequest, NextResponse } from "next/server";
import { apiError, requirePermission, requestMeta } from "@/lib/api";
import { buildTicketCsv, REPORT_DAY_LIMITS } from "@/lib/reports/service";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/tickets/export.csv?days=30&departmentId=&status=
 * CSV download of the filtered ticket report. Gated by the dedicated
 * `tickets.export` permission (not admin.reports.view) and audited as
 * `ticket.exported` — data exports are security-relevant reads.
 */

const DAY_RE = /^\d+$/;
const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const;

export async function GET(req: NextRequest) {
  const guard = await requirePermission("tickets.export");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const rawDays = params.get("days");
  let days = 30;
  if (rawDays !== null && rawDays !== "") {
    if (!DAY_RE.test(rawDays)) {
      return apiError("بازه روزها باید عددی باشد.", 422, "VALIDATION_ERROR");
    }
    const parsed = Number(rawDays);
    if (parsed < REPORT_DAY_LIMITS.min || parsed > REPORT_DAY_LIMITS.max) {
      return apiError(
        `بازه روزها باید بین ${REPORT_DAY_LIMITS.min} تا ${REPORT_DAY_LIMITS.max} باشد.`,
        422,
        "VALIDATION_ERROR"
      );
    }
    days = parsed;
  }

  const departmentId = params.get("departmentId")?.trim() || null;
  const status = params.get("status")?.trim() || null;
  if (status && !TICKET_STATUSES.includes(status as (typeof TICKET_STATUSES)[number])) {
    return apiError("وضعیت تیکت نامعتبر است.", 422, "VALIDATION_ERROR");
  }

  try {
    const csv = await buildTicketCsv({ days, departmentId, status });

    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "ticket.exported",
      entityType: "Ticket",
      metadata: { days, departmentId, status, rows: csv.body.split("\n").length - 1 },
      ...requestMeta(req),
    });

    return new NextResponse(csv.body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csv.filename}"; filename*=UTF-8''${encodeURIComponent(csv.filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[api/admin/reports/tickets/export.csv] failed:", error);
    return apiError("ساخت خروجی CSV ناموفق بود.", 500, "TICKET_EXPORT_FAILED");
  }
}
