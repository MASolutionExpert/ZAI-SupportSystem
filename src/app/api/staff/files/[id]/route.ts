import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  parseBody,
  requirePermission,
} from "@/lib/api";
import { deleteFile, moveFile, renameFile } from "@/lib/files/service";
import { FilesInputError, FilesScopeError } from "@/lib/files/types";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  folderId: z.string().nullable().optional(),
});

/** PATCH /api/staff/files/[id] — rename and/or move a file within its department. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("files.rename");
  if (!guard.ok) return guard.response;

  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const { id } = await params;

  try {
    if (body.data.name) {
      await renameFile(guard.user, id, body.data.name);
    }
    if (body.data.folderId !== undefined) {
      await moveFile(guard.user, id, body.data.folderId);
    }
    return apiOk({ ok: true });
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files/[id]] patch failed:", error);
    return apiError("به‌روزرسانی فایل ناموفق بود.", 500);
  }
}

/** DELETE /api/staff/files/[id] — delete file + blob (permission + scope). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("files.delete");
  if (!guard.ok) return guard.response;

  const { id } = await params;

  try {
    await deleteFile(guard.user, id);
    return apiOk({ ok: true });
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files/[id]] delete failed:", error);
    return apiError("حذف فایل ناموفق بود.", 500);
  }
}
