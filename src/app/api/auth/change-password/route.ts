import { z } from "zod";
import { NextRequest } from "next/server";
import { apiError, apiOk, assertSameOrigin, parseBody, requestMeta } from "@/lib/api";
import { changeOwnPassword } from "@/lib/auth/service";

const changeSchema = z.object({
  currentPassword: z.string().min(1, "رمز عبور فعلی را وارد کنید.").max(128),
  newPassword: z
    .string()
    .min(12, "رمز عبور جدید باید حداقل ۱۲ کاراکتر باشد.")
    .max(128),
  confirmNewPassword: z.string().min(1, "تکرار رمز عبور جدید را وارد کنید."),
});

export async function POST(req: NextRequest) {
  const originGuard = assertSameOrigin(req);
  if (originGuard) return originGuard;

  const parsed = await parseBody(req, changeSchema);
  if (!parsed.ok) return parsed.response;

  const { currentPassword, newPassword, confirmNewPassword } = parsed.data;
  if (newPassword !== confirmNewPassword) {
    return apiError("تکرار رمز عبور با رمز جدید یکسان نیست.", 422, "VALIDATION_ERROR");
  }

  const meta = requestMeta(req);
  const result = await changeOwnPassword(currentPassword, newPassword, meta);
  if (!result.ok) {
    return apiError(result.error, 400, "CHANGE_PASSWORD_FAILED");
  }

  return apiOk({ changed: true });
}
