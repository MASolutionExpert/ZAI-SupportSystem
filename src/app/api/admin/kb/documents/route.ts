import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  requirePermission,
} from "@/lib/api";
import {
  createDocumentFromUpload,
  KbInputError,
} from "@/lib/kb/pipeline";
import { detectAllowedMime, filenameExtension } from "@/lib/kb/mime";
import { KB_DOCUMENT_STATUSES, KB_MAX_DOCUMENT_BYTES } from "@/lib/kb/types";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/kb/documents — management list with optional filters
 * (?collectionId=, ?status=, ?q= title search), newest first, max 200.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("kb.view");
  if (!guard.ok) return guard.response;

  try {
    const params = req.nextUrl.searchParams;
    const collectionId = params.get("collectionId");
    const status = params.get("status");
    const q = params.get("q");

    if (status && !(KB_DOCUMENT_STATUSES as readonly string[]).includes(status)) {
      return apiError("وضعیت سند نامعتبر است.", 422, "VALIDATION_ERROR");
    }

    const documents = await db.knowledgeDocument.findMany({
      where: {
        ...(collectionId ? { collectionId } : {}),
        ...(status ? { status } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        collection: { select: { name: true } },
        uploader: { select: { name: true } },
      },
    });

    return apiOk({
      documents: documents.map((document) => ({
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
      })),
    });
  } catch (error) {
    console.error("[api/admin/kb/documents] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * POST /api/admin/kb/documents — multipart upload + indexing pipeline.
 *
 * Responds 201 even when indexing FAILED (the upload itself succeeded and
 * the failure state is first-class, visible on the document).
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.documents.upload");
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("بدنه درخواست معتبر نیست.", 400, "INVALID_JSON");
  }

  try {
    const file = form.get("file");
    const collectionId = form.get("collectionId");
    const titleField = form.get("title");

    if (!(file instanceof File)) {
      return apiError("فایل سند ارسال نشده است.", 422, "VALIDATION_ERROR");
    }
    if (typeof collectionId !== "string" || !collectionId) {
      return apiError("مجموعه دانش انتخاب نشده است.", 422, "VALIDATION_ERROR");
    }

    const originalFilename = file.name || "document";
    const mimeType = detectAllowedMime(originalFilename, file.type);
    if (!mimeType) {
      return apiError(
        "قالب فایل مجاز نیست؛ فرمت‌های مجاز: PDF، Word (docx)، متن ساده (txt) و Markdown (md).",
        422,
        "VALIDATION_ERROR"
      );
    }
    if (file.size > KB_MAX_DOCUMENT_BYTES) {
      return apiError("حجم فایل بیش از حد مجاز است (حداکثر ۱۵ مگابایت).", 413, "VALIDATION_ERROR");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > KB_MAX_DOCUMENT_BYTES) {
      return apiError("حجم فایل بیش از حد مجاز است (حداکثر ۱۵ مگابایت).", 413, "VALIDATION_ERROR");
    }

    // Title defaults to the filename without its extension.
    const ext = filenameExtension(originalFilename);
    const baseName = ext
      ? originalFilename.slice(0, originalFilename.length - ext.length - 1)
      : originalFilename;
    const title =
      typeof titleField === "string" && titleField.trim()
        ? titleField.trim().slice(0, 200)
        : (baseName.trim() || "سند بدون عنوان").slice(0, 200);

    const result = await createDocumentFromUpload({
      file: { buffer, mimeType, originalFilename },
      title,
      collectionId,
      uploadedBy: guard.user.id,
      uploadedByLabel: guard.user.username,
    });

    return apiOk(
      { documentId: result.documentId, status: result.status, error: result.error },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "KB_VALIDATION_ERROR");
    }
    console.error("[api/admin/kb/documents] upload failed:", error);
    return apiError("بارگذاری سند ناموفق بود.", 500, "UPLOAD_FAILED");
  }
}
