import { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { getStaffTicket } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/staff/tickets/[id] — full staff ticket detail including internal
 * notes (staff-only endpoint; customer endpoints filter them server-side).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const result = await getStaffTicket(auth.user, id);
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({ ticket: result.data.ticket });
  } catch (error) {
    console.error("[api/staff/tickets/[id]] detail failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
