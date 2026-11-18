import type { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { listCitizensForAdmin } from "@/lib/customers/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/citizens — کاربران سامانه (citizen account management list).
 * Requires `admin.citizens.manage`. Query params: q (name substring OR a
 * full national ID — resolved via the HMAC index, never stored/logged),
 * status (ACTIVE|BLOCKED), page, pageSize. The raw national ID is never
 * returned — masked tail only (SECURITY.md §4).
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission("admin.citizens.manage");
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const result = await listCitizensForAdmin({
      query: params.get("q") ?? undefined,
      status: params.get("status") ?? undefined,
      page: Number(params.get("page") ?? "1") || 1,
      pageSize: Number(params.get("pageSize") ?? "20") || 20,
    });
    return apiOk(result);
  } catch (error) {
    console.error("[api/admin/citizens] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
