import { NextRequest } from "next/server";
import { apiOk, apiError, requirePermission } from "@/lib/api";
import { getOperatorActivityReport, REPORT_DAY_LIMITS } from "@/lib/reports/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/operators?days=7
 * Per-operator workload and activity (admin.reports.view): assigned /
 * resolved tickets in the window, replies vs internal notes, current open
 * load, availability and last reply time.
 */

const DAY_RE = /^\d+$/;

export async function GET(req: NextRequest) {
  const guard = await requirePermission("admin.reports.view");
  if (!guard.ok) return guard.response;

  const rawDays = req.nextUrl.searchParams.get("days");
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

  try {
    const report = await getOperatorActivityReport({ days });
    return apiOk(report);
  } catch (error) {
    console.error("[api/admin/reports/operators] failed:", error);
    return apiError("دریافت گزارش فعالیت اپراتورها ناموفق بود.", 500, "OPERATOR_REPORT_FAILED");
  }
}
