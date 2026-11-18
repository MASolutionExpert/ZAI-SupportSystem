import { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/api";
import { getCustomerConversation } from "@/lib/conversations/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/public/conversations/[token] — customer transcript view, token-keyed
 * (no auth). Never leaks internal source refs/scores, retrieval records,
 * provider configuration or the internal conversation id.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;

  try {
    const result = await getCustomerConversation(token);
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data);
  } catch (error) {
    console.error("[api/public/conversations/[token]] get failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
