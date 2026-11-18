import type { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { getCitizenThreadForStaff } from "@/lib/customers/accounts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/staff/citizens/[id] — the citizen's unified thread: their tickets
 * and live-conversation messages inside the operator's department scope
 * (department scoping is enforced SERVER-side; internal notes never appear).
 * Requires `tickets.customer.history.view`.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await requirePermission("tickets.customer.history.view");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const thread = await getCitizenThreadForStaff(auth.user, id);
    if (!thread) {
      return apiError("کاربر یافت نشد.", 404, "NOT_FOUND");
    }
    return apiOk({ thread });
  } catch (error) {
    console.error("[api/staff/citizens/[id]] get failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
