import { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { getStaffConversation } from "@/lib/conversations/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/staff/conversations/[id] — full transcript for operators/managers.
 * Department scope is enforced in the service (403 outside scope).
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission("tickets.view");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    const result = await getStaffConversation(guard.user, id);
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({ conversation: result.data.conversation });
  } catch (error) {
    console.error("[api/staff/conversations/[id]] get failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
