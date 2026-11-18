import { NextRequest, NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/api";
import { getFileForDownload } from "@/lib/files/service";
import { getStorageDriver } from "@/lib/storage";

export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  // RFC 5987: ASCII fallback + UTF-8 filename* so Persian names download well.
  const fallback =
    filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "attachment";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * GET /api/staff/files/[id]/download — the ONLY path to the bytes.
 * Permission (`files.download`) and department scope are re-checked per
 * request; files are stored outside the web root and never served statically.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("files.download");
  if (!guard.ok) return guard.response;

  const { id } = await params;

  try {
    const info = await getFileForDownload(guard.user, id);
    if (!info.ok) return apiError(info.error, info.status);

    let bytes: Buffer;
    try {
      bytes = await getStorageDriver().get(info.storageKey);
    } catch {
      return apiError("محتوای فایل روی دیسک یافت نشد.", 404);
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": info.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(info.filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[api/staff/files/[id]/download] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
