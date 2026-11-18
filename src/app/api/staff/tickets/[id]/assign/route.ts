import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requirePermission, requestMeta } from "@/lib/api";
import { assignTicket } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  // Absent or "auto" → fair-distribution auto assign.
  targetUserId: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/staff/tickets/[id]/assign — manual (targetUserId) or auto
 * (targetUserId absent / "auto") assignment inside the ticket's department.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.assign");
  if (!auth.ok) return auth.response;

  const origin = assertSameOrigin(req);
  if (origin) return origin;

  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const targetUserId =
    body.data.targetUserId && body.data.targetUserId !== "auto"
      ? body.data.targetUserId
      : undefined;

  try {
    const result = await assignTicket({
      user: auth.user,
      ticketId: id,
      targetUserId,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data);
  } catch (error) {
    console.error("[api/staff/tickets/[id]/assign] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
