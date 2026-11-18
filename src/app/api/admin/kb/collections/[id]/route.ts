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
import { kbCollectionUpdateSchema } from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/kb/collections/[id] — name/description/access/isActive.
 *
 * Note: switching access to RESTRICTED or deactivating only affects future
 * retrieval calls — scoping is applied live at query time, so no index
 * rebuild is needed.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.collections.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, kbCollectionUpdateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const existing = await db.knowledgeCollection.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return apiError("مجموعه دانش یافت نشد.", 404, "NOT_FOUND");
    }

    const data: {
      name?: string;
      description?: string | null;
      access?: string;
      isActive?: boolean;
    } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.access !== undefined) data.access = parsed.data.access;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

    const collection = await db.knowledgeCollection.update({
      where: { id },
      data,
    });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.collection.updated",
      entityType: "KnowledgeCollection",
      entityId: id,
      metadata: { collectionId: id, fields: Object.keys(data) },
      ip,
      userAgent,
    });

    return apiOk({ collection });
  } catch (error) {
    console.error("[api/admin/kb/collections/[id]] update failed:", error);
    return apiError("به‌روزرسانی مجموعه دانش ناموفق بود.", 500, "UPDATE_FAILED");
  }
}

/** DELETE /api/admin/kb/collections/[id] — refuse when documents exist. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.collections.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    const collection = await db.knowledgeCollection.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { documents: true } } },
    });
    if (!collection) {
      return apiError("مجموعه دانش یافت نشد.", 404, "NOT_FOUND");
    }
    if (collection._count.documents > 0) {
      return apiError(
        "این مجموعه سند دارد؛ ابتدا اسناد را حذف یا منتقل کنید.",
        409,
        "COLLECTION_NOT_EMPTY"
      );
    }

    // Department grants cascade via the schema (onDelete: Cascade).
    await db.knowledgeCollection.delete({ where: { id } });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.collection.deleted",
      entityType: "KnowledgeCollection",
      entityId: id,
      metadata: { collectionId: id, name: collection.name },
      ip,
      userAgent,
    });

    return apiOk({ deleted: true });
  } catch (error) {
    console.error("[api/admin/kb/collections/[id]] delete failed:", error);
    return apiError("حذف مجموعه دانش ناموفق بود.", 500, "DELETE_FAILED");
  }
}
