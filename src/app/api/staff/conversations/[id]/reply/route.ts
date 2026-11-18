import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requestMeta, requirePermission } from "@/lib/api";
import { replyAsOperator } from "@/lib/conversations/service";
import { CONVERSATION_MODE_LABELS } from "@/lib/conversations/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const replySchema = z.object({
  content: z
    .string()
    .min(2, "متن پیام باید بین ۲ تا ۲۰۰۰ نویسه باشد.")
    .max(2000, "متن پیام باید بین ۲ تا ۲۰۰۰ نویسه باشد."),
});

/**
 * POST /api/staff/conversations/[id]/reply — operator reply; switches the
 * conversation to HUMAN_ACTIVE and self-assigns when unassigned.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("tickets.reply");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, replySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await replyAsOperator({
      user: guard.user,
      conversationId: id,
      content: parsed.data.content,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({
      message: result.data.message,
      conversation: {
        mode: result.data.mode,
        modeLabel: CONVERSATION_MODE_LABELS[result.data.mode],
      },
    });
  } catch (error) {
    console.error("[api/staff/conversations/[id]/reply] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
