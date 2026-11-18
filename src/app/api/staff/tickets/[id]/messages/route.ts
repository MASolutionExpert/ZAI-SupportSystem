import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, requirePermission, requestMeta } from "@/lib/api";
import { can } from "@/lib/rbac/service";
import { addStaffTicketMessage } from "@/lib/tickets/service";

export const dynamic = "force-dynamic";

const MAX_FILES = 5;

/**
 * POST /api/staff/tickets/[id]/messages (multipart) — operator reply or
 * internal note. The permission depends on the message kind: internal notes
 * require the narrower "tickets.notes.add" key, public replies "tickets.reply".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.view");
  if (!auth.ok) return auth.response;

  const origin = assertSameOrigin(req);
  if (origin) return origin;

  const { id } = await params;

  try {
    const form = await req.formData();
    const content = String(form.get("content") ?? "");
    const isInternalNote = String(form.get("isInternalNote") ?? "false") === "true";

    const neededPermission = isInternalNote ? "tickets.notes.add" : "tickets.reply";
    const allowed = await can(auth.user.id, neededPermission);
    if (!allowed) {
      return apiError("برای این اقدام مجوز لازم را ندارید.", 403, "FORBIDDEN");
    }

    const files: { filename: string; buffer: Buffer }[] = [];
    for (const entry of form.getAll("files")) {
      if (entry instanceof File && entry.size > 0) {
        files.push({
          filename: entry.name || "فایل",
          buffer: Buffer.from(await entry.arrayBuffer()),
        });
      }
    }
    if (files.length > MAX_FILES) {
      return apiError("حداکثر ۵ فایل پیوست در هر پیام مجاز است.", 422, "VALIDATION_ERROR");
    }

    const result = await addStaffTicketMessage({
      user: auth.user,
      ticketId: id,
      content,
      isInternalNote,
      attachments: files.length > 0 ? files : undefined,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data, { status: 201 });
  } catch (error) {
    console.error("[api/staff/tickets/[id]/messages] send failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
