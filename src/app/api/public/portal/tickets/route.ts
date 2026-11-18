import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, requestMeta } from "@/lib/api";
import { createPortalTicket, listCustomerTickets } from "@/lib/tickets/service";
import { parseFormData, readFormAttachments } from "../_form";
import { resolvePortalCustomer } from "../_session";

export const dynamic = "force-dynamic";

const ticketFormSchema = z.object({
  nationalId: z
    .string()
    .min(4, "کد ملی را وارد کنید.")
    .max(20, "کد ملی نامعتبر است."),
  fullName: z
    .string()
    .min(3, "نام و نام خانوادگی را کامل وارد کنید.")
    .max(80, "نام و نام خانوادگی بیش از حد طولانی است."),
  password: z
    .string()
    .min(1, "رمز عبور را وارد کنید.")
    .max(128, "رمز عبور نامعتبر است."),
  departmentId: z
    .string()
    .min(5, "دپارتمان را انتخاب کنید.")
    .max(64, "شناسه دپارتمان نامعتبر است."),
  subject: z
    .string()
    .min(3, "موضوع را وارد کنید.")
    .max(150, "موضوع حداکثر ۱۵۰ نویسه است."),
  content: z
    .string()
    .min(1, "توضیحات را وارد کنید.")
    .max(4000, "توضیحات حداکثر ۴۰۰۰ نویسه است."),
});

/**
 * GET /api/public/portal/tickets — the logged-in citizen's own ticket list
 * (portal cookie required; internal notes never appear in these views).
 */
export async function GET(req: NextRequest) {
  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiError("برای مشاهده تاریخچه، ابتدا وارد شوید.", 401, "UNAUTHENTICATED");
  }

  try {
    const result = await listCustomerTickets(customerId);
    return apiOk(result.data);
  } catch (error) {
    console.error("[api/public/portal/tickets] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * POST /api/public/portal/tickets — public ticket creation with citizen
 * identity (Phase 8: کد ملی + password instead of OTP). The FIRST submission
 * registers the account with that password; returning citizens must supply
 * their existing password. Multipart fields: nationalId, fullName, password,
 * departmentId, subject, content, plus zero or more `files` entries.
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const form = await parseFormData(req);
  if (!form) {
    return apiError("بدنه درخواست معتبر نیست.", 400, "INVALID_FORM");
  }

  const fields = ticketFormSchema.safeParse({
    nationalId: form.get("nationalId") ?? "",
    fullName: form.get("fullName") ?? "",
    password: form.get("password") ?? "",
    departmentId: form.get("departmentId") ?? "",
    subject: form.get("subject") ?? "",
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
    const result = await createPortalTicket({
      nationalId: fields.data.nationalId,
      fullName: fields.data.fullName,
      password: fields.data.password,
      departmentId: fields.data.departmentId,
      subject: fields.data.subject,
      content: fields.data.content,
      attachments: files.attachments.length > 0 ? files.attachments : undefined,
      meta: { ip: meta.ip, userAgent: meta.userAgent },
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk(
      {
        ticketId: result.data.ticketId,
        number: result.data.number,
        subject: fields.data.subject,
        status: result.data.status,
        assignedToId: result.data.assignedToId,
        assignedToName: result.data.assignedToName,
        queued: result.data.assignedToId === null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[api/public/portal/tickets] create failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
