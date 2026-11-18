import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/api";
import { getCustomerTicket } from "@/lib/tickets/service";
import { resolvePortalCustomer } from "../../_session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/public/portal/tickets/[id] — the verified customer's own ticket
 * thread. The service hard-filters internal notes server-side; the response
 * NEVER contains them (nor the raw national ID).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiError("برای مشاهده تیکت، ابتدا وارد شوید.", 401, "UNAUTHENTICATED");
  }

  const { id } = await ctx.params;

  try {
    const result = await getCustomerTicket(customerId, id);
    if (!result.ok) return apiError(result.error, result.status);
    return apiOk(result.data);
  } catch (error) {
    console.error("[api/public/portal/tickets/[id]] get failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
