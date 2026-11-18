import { NextRequest } from "next/server";
import { apiOk, apiError, requirePermission } from "@/lib/api";
import { getTicketReport, REPORT_DAY_LIMITS } from "@/lib/reports/service";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/tickets?days=7&departmentId=…
 * Aggregated ticket report (admin.reports.view): totals, status/via
 * breakdowns, per-department counts, zero-filled daily series, backlog.
 */

const DAY_RE = /^\d+$/;

export async function GET(req: NextRequest) {
  const guard = await requirePermission("admin.reports.view");
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const rawDays = params.get("days");
  let days = 7;
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
  if (departmentId) {
    const exists = await db.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    if (!exists) {
      return apiError("دپارتمان مورد نظر یافت نشد.", 422, "VALIDATION_ERROR");
    }
  }

  try {
    const report = await getTicketReport({ days, departmentId });
    return apiOk(report);
  } catch (error) {
    console.error("[api/admin/reports/tickets] failed:", error);
    return apiError("دریافت گزارش تیکت‌ها ناموفق بود.", 500, "TICKET_REPORT_FAILED");
  }
}
