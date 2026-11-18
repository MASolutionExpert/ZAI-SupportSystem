import { z } from "zod";
import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, parseBody, requestMeta } from "@/lib/api";
import { login } from "@/lib/auth/service";
import { resolveLandingPath } from "@/lib/rbac/service";

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "نام کاربری باید حداقل ۳ کاراکتر باشد.")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "نام کاربری فقط می‌تواند شامل حروف لاتین، عدد و . _ - باشد."),
  password: z.string().min(1, "رمز عبور را وارد کنید.").max(128),
});

export async function POST(req: NextRequest) {
  const originGuard = assertSameOrigin(req);
  if (originGuard) return originGuard;

  const parsed = await parseBody(req, loginSchema);
  if (!parsed.ok) return parsed.response;

  const meta = requestMeta(req);
  const result = await login(parsed.data.username, parsed.data.password, meta);

  if (!result.ok) {
    const headers =
      result.retryAfterSeconds && result.retryAfterSeconds > 0
        ? { "Retry-After": String(result.retryAfterSeconds) }
        : undefined;
    return apiError(result.error, 401, "LOGIN_FAILED", headers);
  }

  return apiOk({
    user: result.user,
    mustChangePassword: result.mustChangePassword,
    // Permission-aware landing so operators never hit a denied dashboard.
    landingPath: result.mustChangePassword
      ? "/change-password"
      : await resolveLandingPath(result.user.id),
  });
}
