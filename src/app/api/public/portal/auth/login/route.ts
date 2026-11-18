import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requestMeta } from "@/lib/api";
import { authenticateCitizen } from "@/lib/customers/accounts";
import {
  PORTAL_COOKIE_NAME,
  PORTAL_SESSION_TTL_MS,
  createPortalToken,
  portalCookieOptions,
} from "@/lib/customers/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  nationalId: z
    .string()
    .min(4, "کد ملی را وارد کنید.")
    .max(20, "کد ملی نامعتبر است."),
  password: z
    .string()
    .min(1, "رمز عبور را وارد کنید.")
    .max(128, "رمز عبور نامعتبر است."),
});

/**
 * POST /api/public/portal/auth/login — citizen sign-in with کد ملی + password
 * (Phase 8: replaces the OTP/SMS verification). On success issues the
 * short-lived, httpOnly portal session cookie and returns the display-safe
 * citizen view (masked national ID only, never the raw value).
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.response;

  try {
    const meta = requestMeta(req);
    const result = await authenticateCitizen({
      nationalId: parsed.data.nationalId,
      password: parsed.data.password,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    if (!result.ok) return apiError(result.error, result.status);

    const res = apiOk({ customer: result.profile });
    res.cookies.set(
      PORTAL_COOKIE_NAME,
      createPortalToken(result.profile.id),
      portalCookieOptions(PORTAL_SESSION_TTL_MS / 1000)
    );
    return res;
  } catch (error) {
    console.error("[api/public/portal/auth/login] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
