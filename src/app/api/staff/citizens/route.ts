import type { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { listCitizenThreadsForStaff } from "@/lib/customers/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/staff/citizens — citizen-centric thread list for the support desk
 * (every citizen with tickets/conversations in the operator's department
 * scope, with the last message excerpt). Requires
 * `tickets.customer.history.view`. Query: q (name or full national ID —
 * HMAC-resolved), limit.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission("tickets.customer.history.view");
  if (!auth.ok) return auth.response;

  try {
    const params = req.nextUrl.searchParams;
    const result = await listCitizenThreadsForStaff(auth.user, {
      query: params.get("q") ?? undefined,
      limit: Number(params.get("limit") ?? "60") || 60,
    });
    return apiOk(result);
  } catch (error) {
    console.error("[api/staff/citizens] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
