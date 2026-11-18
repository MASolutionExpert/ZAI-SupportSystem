import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { readAttachmentFile } from "@/lib/tickets/attachments";
import { getCustomerAttachment } from "@/lib/tickets/service";
import { resolvePortalCustomer } from "../../_session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/public/portal/attachments/[id] — authorized attachment download
 * for the verified owner of the ticket. Bytes are streamed straight from
 * the storage root (outside the web root) with a forced download
 * disposition; the storage key never leaves this endpoint.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiError("برای دریافت پیوست، ابتدا وارد شوید.", 401, "UNAUTHENTICATED");
  }

  const { id } = await ctx.params;

  try {
    const auth = await getCustomerAttachment(customerId, id);
    if (!auth.ok) return apiError(auth.error, auth.status);

    let bytes: Buffer;
    try {
      bytes = await readAttachmentFile(auth.storageKey);
    } catch {
      return apiError("فایل پیوست یافت نشد؛ ممکن است حذف شده باشد.", 404, "FILE_NOT_FOUND");
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": auth.mimeType,
        "Content-Disposition": `attachment; filename="att"; filename*=UTF-8''${encodeURIComponent(
          auth.filename
        )}`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[api/public/portal/attachments/[id]] get failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
