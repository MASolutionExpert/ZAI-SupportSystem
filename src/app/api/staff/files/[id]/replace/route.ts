import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, requirePermission } from "@/lib/api";
import { replaceFile } from "@/lib/files/service";
import { FilesInputError, FilesScopeError } from "@/lib/files/types";

export const dynamic = "force-dynamic";

/**
 * PUT /api/staff/files/[id]/replace — replace file content (multipart).
 * Content verification, quota delta and mandatory AV scan all apply; the
 * version counter bumps and the old blob is removed only after success.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("files.replace");
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("بدنه درخواست معتبر نیست.", 400, "INVALID_JSON");
  }

  const { id } = await params;

  try {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return apiError("فایل جایگزین ارسال نشده است.", 422, "VALIDATION_ERROR");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await replaceFile(guard.user, id, {
      filename: file.name || "file",
      buffer,
    });

    if (!result.ok) {
      return apiError(result.error, 422, "REPLACE_REJECTED");
    }
    return apiOk({ file: result.file });
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files/[id]/replace] failed:", error);
    return apiError("جایگزینی فایل ناموفق بود.", 500, "REPLACE_FAILED");
  }
}
