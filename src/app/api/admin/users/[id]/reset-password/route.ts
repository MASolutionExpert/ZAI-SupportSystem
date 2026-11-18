import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { resetUserPassword } from "@/lib/admin/users";
import { resetPasswordSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/reset-password — credential reset.
 * The one-time plaintext is returned only in this response and never stored
 * or audited; all sessions of the target are revoked immediately.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.users.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, resetPasswordSchema);
  if (!parsed.ok) return parsed.response;

  const result = await resetUserPassword(
    id,
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "RESET_REJECTED");

  return apiOk({ temporaryPassword: result.temporaryPassword });
}
