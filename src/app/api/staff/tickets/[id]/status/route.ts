import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requirePermission, requestMeta } from "@/lib/api";
import { changeTicketStatus } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  toStatus: z.string().min(1),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/staff/tickets/[id]/status — operator status change; the
 * transition table (TICKET_TRANSITIONS) is enforced by the service.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.status.change");
  if (!auth.ok) return auth.response;

  const origin = assertSameOrigin(req);
  if (origin) return origin;

  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  try {
    const result = await changeTicketStatus({
      user: auth.user,
      ticketId: id,
      toStatus: body.data.toStatus,
      note: body.data.note,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data);
  } catch (error) {
    console.error("[api/staff/tickets/[id]/status] change failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
