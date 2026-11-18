import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requirePermission, requestMeta } from "@/lib/api";
import { transferTicket } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  departmentId: z.string().min(1).max(64),
});

/**
 * POST /api/staff/tickets/[id]/transfer — move the ticket to another
 * department; unassigns and re-runs fair distribution in the target.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.transfer");
  if (!auth.ok) return auth.response;

  const origin = assertSameOrigin(req);
  if (origin) return origin;

  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  try {
    const result = await transferTicket({
      user: auth.user,
      ticketId: id,
      departmentId: body.data.departmentId,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data);
  } catch (error) {
    console.error("[api/staff/tickets/[id]/transfer] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
