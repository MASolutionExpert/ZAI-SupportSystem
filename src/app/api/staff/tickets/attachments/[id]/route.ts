import { NextRequest, NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/api";
import { getStaffAttachment } from "@/lib/tickets/service";
import { readAttachmentFile } from "@/lib/tickets/attachments";

export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  // RFC 5987: ASCII fallback + UTF-8 filename* so Persian names download well.
  const fallback =
    filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "attachment";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * GET /api/staff/tickets/attachments/[id] — authorized staff download.
 * Department scope is re-checked per request by the service; the bytes are
 * streamed from the storage root outside the web root.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const info = await getStaffAttachment(auth.user, id);
    if (!info.ok) return apiError(info.error, info.status);

    let bytes: Buffer;
    try {
      bytes = await readAttachmentFile(info.storageKey);
    } catch {
      return apiError("فایل پیوست روی دیسک یافت نشد.", 404);
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
    console.error("[api/staff/tickets/attachments/[id]] download failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
