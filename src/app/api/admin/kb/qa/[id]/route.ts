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
import { serializeQaEntry } from "@/lib/kb/serialize";
import { kbQaUpdateSchema } from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const QA_INCLUDE = {
  createdBy: { select: { name: true } },
  alternates: { select: { id: true, question: true } },
  departments: { include: { department: { select: { id: true, name: true } } } },
} as const;

/** GET /api/admin/kb/qa/[id] — single curated Q&A entry. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission("kb.view");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    const entry = await db.knowledgeQaEntry.findUnique({
      where: { id },
      include: QA_INCLUDE,
    });
    if (!entry) {
      return apiError("مورد پرسش و پاسخ یافت نشد.", 404, "NOT_FOUND");
    }
    return apiOk({ entry: serializeQaEntry(entry) });
  } catch (error) {
    console.error("[api/admin/kb/qa/[id]] detail failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * PATCH /api/admin/kb/qa/[id] — content edits. Alternates are replaced
 * wholesale when provided. Department changes are handled by the dedicated
 * departments endpoint, status by the publish endpoint.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.qa.edit");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, kbQaUpdateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const entry = await db.$transaction(async (tx) => {
      const data: {
        question?: string;
        officialAnswer?: string;
        category?: string | null;
        keywords?: string | null;
      } = {};
      if (parsed.data.question !== undefined) data.question = parsed.data.question;
      if (parsed.data.officialAnswer !== undefined) {
        data.officialAnswer = parsed.data.officialAnswer;
      }
      if (parsed.data.category !== undefined) data.category = parsed.data.category;
      if (parsed.data.keywords !== undefined) {
        data.keywords = parsed.data.keywords.length
          ? JSON.stringify(parsed.data.keywords)
          : null;
      }

      await tx.knowledgeQaEntry.update({
        where: { id },
        data,
      });

      if (parsed.data.alternates !== undefined) {
        // Wholesale replace: delete all, recreate from the submitted list.
        await tx.knowledgeQaAlternate.deleteMany({ where: { entryId: id } });
        if (parsed.data.alternates.length > 0) {
          await tx.knowledgeQaAlternate.createMany({
            data: parsed.data.alternates.map((question) => ({ entryId: id, question })),
          });
        }
      }

      return tx.knowledgeQaEntry.findUnique({ where: { id }, include: QA_INCLUDE });
    });

    if (!entry) {
      return apiError("مورد پرسش و پاسخ یافت نشد.", 404, "NOT_FOUND");
    }

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.qa.updated",
      entityType: "KnowledgeQaEntry",
      entityId: id,
      metadata: { entryId: id, fields: Object.keys(parsed.data) },
      ip,
      userAgent,
    });

    return apiOk({ entry: serializeQaEntry(entry) });
  } catch (error) {
    console.error("[api/admin/kb/qa/[id]] patch failed:", error);
    return apiError("به‌روزرسانی پرسش و پاسخ ناموفق بود.", 500, "UPDATE_FAILED");
  }
}

/** DELETE /api/admin/kb/qa/[id] — delete entry (assignments cascade). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.qa.publish");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    const entry = await db.knowledgeQaEntry.findUnique({
      where: { id },
      select: { id: true, question: true },
    });
    if (!entry) {
      return apiError("مورد پرسش و پاسخ یافت نشد.", 404, "NOT_FOUND");
    }

    // Alternates + department assignments cascade via the schema.
    await db.knowledgeQaEntry.delete({ where: { id } });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.qa.deleted",
      entityType: "KnowledgeQaEntry",
      entityId: id,
      metadata: { entryId: id, question: entry.question },
      ip,
      userAgent,
    });

    return apiOk({ deleted: true });
  } catch (error) {
    console.error("[api/admin/kb/qa/[id]] delete failed:", error);
    return apiError("حذف پرسش و پاسخ ناموفق بود.", 500, "DELETE_FAILED");
  }
}
