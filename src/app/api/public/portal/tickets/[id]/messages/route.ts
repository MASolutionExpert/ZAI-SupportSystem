import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, requestMeta } from "@/lib/api";
import { addCustomerTicketMessage } from "@/lib/tickets/service";
import { parseFormData, readFormAttachments } from "../../../_form";
import { resolvePortalCustomer } from "../../../_session";

export const dynamic = "force-dynamic";

const messageFormSchema = z.object({
  content: z
    .string()
    .min(1, "متن پیام را وارد کنید.")
    .max(4000, "متن پیام حداکثر ۴۰۰۰ نویسه است."),
});

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/public/portal/tickets/[id]/messages — customer reply (verified
 * owner only). The service reopens RESOLVED/CLOSED tickets automatically.
 * Multipart fields: content + zero or more `files` entries.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiError("برای ارسال پاسخ، ابتدا وارد شوید.", 401, "UNAUTHENTICATED");
  }

  const { id } = await ctx.params;

  const form = await parseFormData(req);
  if (!form) {
    return apiError("بدنه درخواست معتبر نیست.", 400, "INVALID_FORM");
  }

  const fields = messageFormSchema.safeParse({
    content: form.get("content") ?? "",
  });
  if (!fields.success) {
    const first = fields.error.issues[0];
    return apiError(first?.message ?? "ورودی نامعتبر است.", 422, "VALIDATION_ERROR");
  }

  const files = await readFormAttachments(form);
  if (!files.ok) return files.response;

  try {
    const meta = requestMeta(req);
    const result = await addCustomerTicketMessage({
      customerId,
      ticketId: id,
      content: fields.data.content,
      attachments: files.attachments.length > 0 ? files.attachments : undefined,
      meta: { ip: meta.ip, userAgent: meta.userAgent },
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(result.data, { status: 201 });
  } catch (error) {
    console.error("[api/public/portal/tickets/[id]/messages] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
