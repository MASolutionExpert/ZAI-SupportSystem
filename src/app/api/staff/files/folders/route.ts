import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requirePermission } from "@/lib/api";
import { createFolder } from "@/lib/files/service";
import { FilesInputError, FilesScopeError } from "@/lib/files/types";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  departmentId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(80),
});

/** POST /api/staff/files/folders — create a nested folder (permission + scope). */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("files.folders.create");
  if (!guard.ok) return guard.response;

  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  try {
    const folder = await createFolder(
      guard.user,
      body.data.departmentId,
      body.data.parentId ?? null,
      body.data.name
    );
    return apiOk({ folder }, { status: 201 });
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files/folders] create failed:", error);
    return apiError("ایجاد پوشه ناموفق بود.", 500);
  }
}
