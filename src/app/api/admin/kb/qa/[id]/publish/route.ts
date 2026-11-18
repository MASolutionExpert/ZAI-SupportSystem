import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  parseBody,
  requestMeta,
  requirePermission,
} from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { kbQaPublishSchema } from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/kb/qa/[id]/publish — publish an entry (status PUBLISHED)
 * or revert it to DRAFT. Only PUBLISHED entries are retrievable.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.qa.publish");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, kbQaPublishSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const entry = await db.knowledgeQaEntry.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!entry) {
      return apiError("مورد پرسش و پاسخ یافت نشد.", 404, "NOT_FOUND");
    }

    const nextStatus = parsed.data.published ? "PUBLISHED" : "DRAFT";
    const updated = await db.knowledgeQaEntry.update({
      where: { id },
      data: { status: nextStatus },
      select: { id: true, status: true },
    });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: parsed.data.published ? "kb.qa.published" : "kb.qa.unpublished",
      entityType: "KnowledgeQaEntry",
      entityId: id,
      metadata: { entryId: id, from: entry.status, to: updated.status },
      ip,
      userAgent,
    });

    return apiOk({ id: updated.id, status: updated.status });
  } catch (error) {
    console.error("[api/admin/kb/qa/[id]/publish] failed:", error);
    return apiError("تغییر وضعیت انتشار ناموفق بود.", 500, "PUBLISH_FAILED");
  }
}
