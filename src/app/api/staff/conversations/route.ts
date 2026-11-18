import { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { listStaffConversations } from "@/lib/conversations/service";

export const dynamic = "force-dynamic";

const FILTERS = ["active", "resolved", "all"] as const;
type ConversationFilter = typeof FILTERS[number];

/**
 * GET /api/staff/conversations?filter=active|resolved|all — operator inbox,
 * department-scoped (scope resolution happens in the service).
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("tickets.view");
  if (!guard.ok) return guard.response;

  const filterParam = req.nextUrl.searchParams.get("filter") ?? "active";
  if (!(FILTERS as readonly string[]).includes(filterParam)) {
    return apiError("مقدار فیلتر نامعتبر است.", 422, "VALIDATION_ERROR");
  }

  try {
    const result = await listStaffConversations(guard.user, {
      filter: filterParam as ConversationFilter,
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({ conversations: result.data.conversations });
  } catch (error) {
    console.error("[api/staff/conversations] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
