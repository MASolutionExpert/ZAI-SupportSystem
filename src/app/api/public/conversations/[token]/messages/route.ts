import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requestMeta } from "@/lib/api";
import { addCustomerMessage } from "@/lib/conversations/service";
import { CONVERSATION_MODE_LABELS } from "@/lib/conversations/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const messageSchema = z.object({
  content: z
    .string()
    .min(2, "متن پیام باید بین ۲ تا ۲۰۰۰ نویسه باشد.")
    .max(2000, "متن پیام باید بین ۲ تا ۲۰۰۰ نویسه باشد."),
});

/**
 * POST /api/public/conversations/[token]/messages — customer turn.
 *
 * When the conversation is AI-assisted this endpoint runs the grounded
 * pipeline (retrieval → optional provider call) and can legitimately take
 * several seconds; the client shows a typing state meanwhile.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const { token } = await ctx.params;
  const parsed = await parseBody(req, messageSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await addCustomerMessage({
      token,
      content: parsed.data.content,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    const { userMessage, assistantMessage, escalatedOffer, mode } = result.data;
    return apiOk({
      userMessage,
      assistantMessage,
      escalatedOffer,
      mode,
      modeLabel: CONVERSATION_MODE_LABELS[mode],
    });
  } catch (error) {
    // Sanitized by design: message content is never included in logs here.
    console.error(
      `[api/public/conversations/[token]/messages] failed (token=${token.slice(0, 6)}…):`,
      error
    );
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
