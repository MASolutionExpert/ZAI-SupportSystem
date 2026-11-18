import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, requirePermission } from "@/lib/api";
import { listFiles, uploadFiles } from "@/lib/files/service";
import { FilesInputError, FilesScopeError } from "@/lib/files/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/staff/files?departmentId=&folderId= — department-scoped listing
 * (folders + files + breadcrumb + usage). Scope re-checked server-side.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("files.view");
  if (!guard.ok) return guard.response;

  try {
    const departmentId = req.nextUrl.searchParams.get("departmentId");
    const folderIdParam = req.nextUrl.searchParams.get("folderId");

    if (!departmentId) {
      return apiError("انتخاب دپارتمان الزامی است.", 422, "VALIDATION_ERROR");
    }

    const listing = await listFiles(
      guard.user,
      departmentId,
      folderIdParam && folderIdParam !== "root" ? folderIdParam : null
    );
    return apiOk(listing);
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * POST /api/staff/files — multipart batch upload (departmentId, folderId,
 * files[]). All-or-nothing validation: extension allowlist, content-based
 * MIME verification, size caps, cumulative quotas and mandatory AV scan all
 * run before anything is stored.
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("files.upload");
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("بدنه درخواست معتبر نیست.", 400, "INVALID_JSON");
  }

  try {
    const departmentId = form.get("departmentId");
    const folderIdRaw = form.get("folderId");
    const entries = form.getAll("files");

    if (typeof departmentId !== "string" || !departmentId) {
      return apiError("دپارتمان انتخاب نشده است.", 422, "VALIDATION_ERROR");
    }
    const folderId =
      typeof folderIdRaw === "string" && folderIdRaw && folderIdRaw !== "root" ? folderIdRaw : null;

    const files = entries.filter((e): e is File => e instanceof File);
    if (files.length === 0) {
      return apiError("هیچ فایلی برای بارگذاری ارسال نشده است.", 422, "VALIDATION_ERROR");
    }

    const inputs: Array<{ filename: string; buffer: Buffer }> = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      inputs.push({ filename: file.name || "file", buffer });
    }

    const result = await uploadFiles(guard.user, departmentId, folderId, inputs);
    if (!result.ok) {
      return apiError(result.error, 422, "UPLOAD_REJECTED");
    }

    return apiOk({ uploaded: result.uploaded }, { status: 201 });
  } catch (error) {
    if (error instanceof FilesScopeError) return apiError(error.message, error.status, "FORBIDDEN");
    if (error instanceof FilesInputError) return apiError(error.message, error.status, "FILES_ERROR");
    console.error("[api/staff/files] upload failed:", error);
    return apiError("بارگذاری فایل ناموفق بود.", 500, "UPLOAD_FAILED");
  }
}
