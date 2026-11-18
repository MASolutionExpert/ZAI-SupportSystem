import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, requirePermission, requestMeta } from "@/lib/api";
import { createInternalTicket, listTickets } from "@/lib/tickets/service";
import { isTicketStatus, type TicketStatus } from "@/lib/tickets/types";

export const dynamic = "force-dynamic";

const MAX_INTERNAL_FILES = 5;

/**
 * GET /api/staff/tickets?q=&status=open|all|<status>&departmentId=&assigneeId=mine|unassigned|<id>
 * Operator ticket queue — department scope is resolved server-side.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission("tickets.view");
  if (!auth.ok) return auth.response;

  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() || undefined;
    const rawStatus = sp.get("status") || "open";
    const status: TicketStatus | "open" | "all" | undefined =
      rawStatus === "open" || rawStatus === "all"
        ? rawStatus
        : isTicketStatus(rawStatus)
          ? rawStatus
          : undefined;

    if (rawStatus !== "open" && rawStatus !== "all" && !status) {
      return apiError("مقدار فیلتر وضعیت نامعتبر است.", 422, "VALIDATION_ERROR");
    }

    const departmentId = sp.get("departmentId") || undefined;
    const assigneeId = sp.get("assigneeId") || undefined;

    const result = await listTickets(auth.user, {
      q,
      status,
      departmentId,
      assigneeId: assigneeId || undefined,
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({ tickets: result.data.tickets });
  } catch (error) {
    console.error("[api/staff/tickets] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * POST /api/staff/tickets (multipart) — internal registration by an operator:
 * nationalId, fullName, departmentId, subject, content + files[].
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission("tickets.create.internal");
  if (!auth.ok) return auth.response;

  const origin = assertSameOrigin(req);
  if (origin) return origin;

  try {
    const form = await req.formData();

    const nationalId = String(form.get("nationalId") ?? "");
    const fullName = String(form.get("fullName") ?? "");
    const departmentId = String(form.get("departmentId") ?? "");
    const subject = String(form.get("subject") ?? "");
    const content = String(form.get("content") ?? "");

    const files: { filename: string; buffer: Buffer }[] = [];
    for (const entry of form.getAll("files")) {
      if (entry instanceof File && entry.size > 0) {
        files.push({
          filename: entry.name || "فایل",
          buffer: Buffer.from(await entry.arrayBuffer()),
        });
      }
    }
    if (files.length > MAX_INTERNAL_FILES) {
      return apiError("حداکثر ۵ فایل پیوست در هر تیکت مجاز است.", 422, "VALIDATION_ERROR");
    }

    const result = await createInternalTicket({
      user: auth.user,
      nationalId,
      fullName,
      departmentId,
      subject,
      content,
      attachments: files.length > 0 ? files : undefined,
      meta: requestMeta(req),
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data, { status: 201 });
  } catch (error) {
    console.error("[api/staff/tickets] internal create failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
