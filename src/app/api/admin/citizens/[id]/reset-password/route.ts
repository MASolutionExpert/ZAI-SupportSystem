import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requirePermission } from "@/lib/api";
import { resetCitizenPasswordByAdmin } from "@/lib/customers/accounts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z
  .object({
    // Omitted/empty → a readable temporary password is generated server-side.
    password: z.string().min(8).max(128).optional(),
  })
  .refine((data) => !data.password || /^(?=.*[A-Za-z])(?=.*\d).+$/.test(data.password), {
    message: "رمز عبور باید شامل حروف لاتین و عدد باشد.",
    path: ["password"],
  });

/**
 * POST /api/admin/citizens/[id]/reset-password — superadmin password reset
 * for a citizen who forgot theirs. The plaintext is returned EXACTLY ONCE in
 * this response (never stored, never audited, never shown again).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const auth = await requirePermission("admin.citizens.manage");
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.response;

  try {
    const { id } = await ctx.params;
    const result = await resetCitizenPasswordByAdmin({
      actorId: auth.user.id,
      actorLabel: auth.user.name || auth.user.username,
      citizenId: id,
      password: parsed.data.password,
    });
    if (!result.ok) return apiError(result.error, result.status);
    return apiOk({ password: result.password });
  } catch (error) {
    console.error("[api/admin/citizens/[id]/reset-password] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
