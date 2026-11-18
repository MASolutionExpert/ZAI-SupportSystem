import { NextRequest } from "next/server";
import { apiError, apiOk, requireAuth } from "@/lib/api";
import { can } from "@/lib/rbac/service";
import { getUsageReport } from "@/lib/files/service";
import { FilesScopeError } from "@/lib/files/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/staff/files/usage?departmentId= — storage usage view
 * (global total, per-department, per-operator). Scope follows department
 * membership or the global key.
 *
 * Since Phase 6 the storage-administration page also reads this report, so
 * the guard accepts either `files.quotas.manage` (quota managers) or
 * `admin.storage.manage` (storage administration).
 */
export async function GET(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const [canQuotas, canStorageAdmin] = await Promise.all([
    can(guard.user.id, "files.quotas.manage"),
    can(guard.user.id, "admin.storage.manage"),
  ]);
  if (!canQuotas && !canStorageAdmin) {
    return apiError("دسترسی لازم را ندارید.", 403, "FORBIDDEN");
  }

  try {
    const departmentId = req.nextUrl.searchParams.get("departmentId") ?? undefined;
    const report = await getUsageReport(guard.user, departmentId);
    return apiOk(report);
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    console.error("[api/staff/files/usage] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
