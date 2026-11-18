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
import { can } from "@/lib/rbac/service";
import { db } from "@/lib/db";
import { deleteDocument, KbInputError } from "@/lib/kb/pipeline";
import { kbFileExists } from "@/lib/kb/store";
import { kbDocumentPatchSchema } from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/kb/documents/[id] — full detail: list fields, version
 * history, a text preview built from the first active chunks, and whether
 * the stored file is present in the storage backend.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission("kb.view");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    const document = await db.knowledgeDocument.findUnique({
      where: { id },
      include: {
        collection: { select: { name: true } },
        uploader: { select: { name: true } },
        versions: {
          orderBy: { versionNo: "desc" },
          include: { uploader: { select: { name: true } } },
        },
      },
    });
    if (!document) {
      return apiError("سند یافت نشد.", 404, "NOT_FOUND");
    }

    const previewChunks = await db.knowledgeChunk.findMany({
      where: { documentId: id, isActive: true },
      orderBy: { ordinal: "asc" },
      take: 3,
      select: { text: true },
    });
    const textPreview = previewChunks.length
      ? previewChunks.map((chunk) => chunk.text).join("\n\n").slice(0, 4000)
      : null;

    const storagePresent = await kbFileExists(document.storageKey);

    return apiOk({
      document: {
        id: document.id,
        title: document.title,
        collectionId: document.collectionId,
        collectionName: document.collection.name,
        originalFilename: document.originalFilename,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        status: document.status,
        statusError: document.statusError,
        chunkCount: document.chunkCount,
        extractedChars: document.extractedChars,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        uploaderName: document.uploader.name,
        versions: document.versions.map((version) => ({
          id: version.id,
          versionNo: version.versionNo,
          sizeBytes: version.sizeBytes,
          mimeType: version.mimeType,
          checksum: version.checksum,
          uploadedAt: version.uploadedAt,
          uploaderName: version.uploader.name,
        })),
        textPreview,
        storagePresent,
      },
    });
  } catch (error) {
    console.error("[api/admin/kb/documents/[id]] detail failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * PATCH /api/admin/kb/documents/[id] — metadata-only edits (title,
 * collection, active/inactive). Never touches chunks (spec 5.1).
 *
 * `isActive` is translated into the document STATUS state machine:
 *  - false → status DISABLED (any non-DISABLED status; drops out of retrieval)
 *  - true  → restored from DISABLED to INDEXED when active chunks exist,
 *            otherwise back to FAILED/UPLOADED — never fake-indexing a
 *            document that never indexed (failure is first-class, spec 5.1).
 *
 * Permission model: kb.view opens the route; changing title/isActive
 * additionally requires kb.documents.upload; moving the document to another
 * collection requires kb.collections.manage.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.view");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, kbDocumentPatchSchema);
  if (!parsed.ok) return parsed.response;

  const wantsTitleOrActive =
    parsed.data.title !== undefined || parsed.data.isActive !== undefined;
  const wantsCollection = parsed.data.collectionId !== undefined;

  if (wantsTitleOrActive) {
    const allowed = await can(guard.user.id, "kb.documents.upload");
    if (!allowed) {
      return apiError("برای ویرایش عنوان یا وضعیت سند دسترسی لازم را ندارید.", 403, "FORBIDDEN");
    }
  }
  if (wantsCollection) {
    const allowed = await can(guard.user.id, "kb.collections.manage");
    if (!allowed) {
      return apiError("برای انتقال سند به مجموعه دیگر دسترسی لازم را ندارید.", 403, "FORBIDDEN");
    }
  }

  try {
    const document = await db.knowledgeDocument.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        statusError: true,
        _count: { select: { chunks: { where: { isActive: true } } } },
      },
    });
    if (!document) {
      return apiError("سند یافت نشد.", 404, "NOT_FOUND");
    }

    if (wantsCollection) {
      const collection = await db.knowledgeCollection.findUnique({
        where: { id: parsed.data.collectionId! },
        select: { id: true },
      });
      if (!collection) {
        return apiError("مجموعه دانش مقصد یافت نشد.", 404, "NOT_FOUND");
      }
    }

    const data: {
      title?: string;
      collectionId?: string;
      status?: string;
    } = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.collectionId !== undefined) data.collectionId = parsed.data.collectionId;
    if (parsed.data.isActive !== undefined) {
      // Disable: any live status → DISABLED (chunk records stay intact).
      if (!parsed.data.isActive) {
        if (document.status === "DISABLED") {
          return apiError("این سند از قبل غیرفعال است.", 409, "ALREADY_DISABLED");
        }
        data.status = "DISABLED";
      } else {
        // Enable: only meaningful from DISABLED; restore the honest status.
        if (document.status !== "DISABLED") {
          return apiError("این سند از قبل فعال است.", 409, "ALREADY_ACTIVE");
        }
        if (document._count.chunks > 0) {
          data.status = "INDEXED";
        } else if (document.statusError) {
          data.status = "FAILED";
        } else {
          data.status = "UPLOADED";
        }
      }
    }

    const updated = await db.knowledgeDocument.update({
      where: { id },
      data,
      include: {
        collection: { select: { name: true } },
        uploader: { select: { name: true } },
      },
    });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.document.metadata.updated",
      entityType: "KnowledgeDocument",
      entityId: id,
      metadata: { documentId: id, fields: Object.keys(data) },
      ip,
      userAgent,
    });

    return apiOk({
      document: {
        id: updated.id,
        title: updated.title,
        collectionId: updated.collectionId,
        collectionName: updated.collection.name,
        originalFilename: updated.originalFilename,
        mimeType: updated.mimeType,
        sizeBytes: updated.sizeBytes,
        status: updated.status,
        statusError: updated.statusError,
        chunkCount: updated.chunkCount,
        extractedChars: updated.extractedChars,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        uploaderName: updated.uploader.name,
      },
    });
  } catch (error) {
    console.error("[api/admin/kb/documents/[id]] patch failed:", error);
    return apiError("به‌روزرسانی سند ناموفق بود.", 500, "UPDATE_FAILED");
  }
}

/** DELETE /api/admin/kb/documents/[id] — delete row + stored files. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.documents.delete");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  try {
    await deleteDocument(id, { id: guard.user.id, label: guard.user.username });
    return apiOk({ deleted: true });
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "NOT_FOUND");
    }
    console.error("[api/admin/kb/documents/[id]] delete failed:", error);
    return apiError("حذف سند ناموفق بود.", 500, "DELETE_FAILED");
  }
}
