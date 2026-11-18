import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  requirePermission,
} from "@/lib/api";
import { KbInputError, processDocument } from "@/lib/kb/pipeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/kb/documents/[id]/reprocess — re-run extraction + chunk
 * indexing. Allowed from any status (including DISABLED / FAILED): the
 * result re-sets INDEXED or FAILED and marks chunks active again.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.documents.reprocess");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    const result = await processDocument(id, {
      id: guard.user.id,
      label: guard.user.username,
    });
    return apiOk({ status: result.status, error: result.error });
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "NOT_FOUND");
    }
    console.error("[api/admin/kb/documents/[id]/reprocess] failed:", error);
    return apiError("پردازش مجدد سند ناموفق بود.", 500, "REPROCESS_FAILED");
  }
}
