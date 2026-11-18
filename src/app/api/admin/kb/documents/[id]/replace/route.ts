import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  requirePermission,
} from "@/lib/api";
import { KbInputError, replaceDocumentVersion } from "@/lib/kb/pipeline";
import { detectAllowedMime } from "@/lib/kb/mime";
import { KB_MAX_DOCUMENT_BYTES } from "@/lib/kb/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/kb/documents/[id]/replace — upload a new version of the
 * document (multipart). The new file becomes the active version; the old
 * version row is kept for history. Re-indexes afterwards.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.documents.upload");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("بدنه درخواست معتبر نیست.", 400, "INVALID_JSON");
  }

  try {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return apiError("فایل سند ارسال نشده است.", 422, "VALIDATION_ERROR");
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

    const result = await replaceDocumentVersion({
      documentId: id,
      file: { buffer, mimeType, originalFilename },
      uploadedBy: guard.user.id,
      uploadedByLabel: guard.user.username,
    });

    return apiOk({ status: result.status, error: result.error });
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "KB_VALIDATION_ERROR");
    }
    console.error("[api/admin/kb/documents/[id]/replace] failed:", error);
    return apiError("جایگزینی نسخه سند ناموفق بود.", 500, "REPLACE_FAILED");
  }
}
