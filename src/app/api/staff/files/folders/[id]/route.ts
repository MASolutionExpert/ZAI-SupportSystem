import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  parseBody,
  requirePermission,
} from "@/lib/api";
import { deleteFolder, moveFolder, renameFolder } from "@/lib/files/service";
import { FilesInputError, FilesScopeError } from "@/lib/files/types";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  parentId: z.string().nullable().optional(),
});

/**
 * PATCH /api/staff/files/folders/[id] — rename and/or move a folder.
 * Moving across departments is intentionally impossible (server-enforced).
 */
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
      await renameFolder(guard.user, id, body.data.name);
    }
    if (body.data.parentId !== undefined) {
      await moveFolder(guard.user, id, body.data.parentId);
    }
    return apiOk({ ok: true });
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files/folders/[id]] patch failed:", error);
    return apiError("به‌روزرسانی پوشه ناموفق بود.", 500);
  }
}

/** DELETE /api/staff/files/folders/[id] — delete subtree (files + blobs). */
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
    await deleteFolder(guard.user, id);
    return apiOk({ ok: true });
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files/folders/[id]] delete failed:", error);
    return apiError("حذف پوشه ناموفق بود.", 500);
  }
}
