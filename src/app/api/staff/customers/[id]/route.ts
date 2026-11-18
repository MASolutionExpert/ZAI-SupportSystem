import { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { getCustomerHistory } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/staff/customers/[id] — operator view of a customer profile plus
 * their ticket history (department-scoped by the service).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.customer.history.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const result = await getCustomerHistory(auth.user, id);
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data);
  } catch (error) {
    console.error("[api/staff/customers/[id]] history failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
