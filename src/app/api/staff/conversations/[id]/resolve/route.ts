import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, requestMeta, requirePermission } from "@/lib/api";
import { resolveConversation } from "@/lib/conversations/service";
import { CONVERSATION_MODE_LABELS } from "@/lib/conversations/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/staff/conversations/[id]/resolve — close the conversation with a
 * SYSTEM message. Idempotent for already-resolved conversations.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("tickets.status.change");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    const result = await resolveConversation({
      user: guard.user,
      conversationId: id,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({
      conversation: {
        mode: result.data.mode,
        modeLabel: CONVERSATION_MODE_LABELS[result.data.mode],
      },
    });
  } catch (error) {
    console.error("[api/staff/conversations/[id]/resolve] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
