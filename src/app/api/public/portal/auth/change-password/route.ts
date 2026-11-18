import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requestMeta } from "@/lib/api";
import { changeCitizenPassword } from "@/lib/customers/accounts";
import { resolvePortalCustomer } from "../../_session";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z
    .string()
    .min(1, "رمز عبور فعلی را وارد کنید.")
    .max(128, "رمز عبور نامعتبر است."),
  newPassword: z
    .string()
    .min(8, "رمز جدید باید حداقل ۸ کاراکتر باشد.")
    .max(128, "رمز عبور نامعتبر است."),
});

/**
 * POST /api/public/portal/auth/change-password — citizen self-service
 * password change (portal cookie required; current password verified
 * server-side). Clears the superadmin must-change hint on success.
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiError("برای تغییر رمز، ابتدا وارد شوید.", 401, "UNAUTHENTICATED");
  }

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.response;

  try {
    const meta = requestMeta(req);
    const result = await changeCitizenPassword({
      customerId,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    if (!result.ok) return apiError(result.error, result.status);

    return apiOk({ changed: true });
  } catch (error) {
    console.error("[api/public/portal/auth/change-password] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
