import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, requestMeta } from "@/lib/api";
import { requestOperatorHandoff } from "@/lib/conversations/service";
import { CONVERSATION_MODE_LABELS } from "@/lib/conversations/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * POST /api/public/conversations/[token]/handoff — customer requests a human
 * operator. Idempotent: only effective while the conversation is AI-assisted.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const { token } = await ctx.params;

  try {
    const result = await requestOperatorHandoff({ token, meta: requestMeta(req) });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({
      mode: result.data.mode,
      modeLabel: CONVERSATION_MODE_LABELS[result.data.mode],
    });
  } catch (error) {
    console.error("[api/public/conversations/[token]/handoff] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
