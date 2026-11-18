import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { updateUser } from "@/lib/admin/users";
import { userUpdateSchema } from "@/lib/validators";
import { resolveSession } from "@/lib/auth/session";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/users/[id] — profile, role, status, availability. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.users.manage");
  if (!guard.ok) return guard.response;

  const resolved = await resolveSession();

  const { id } = await ctx.params;
  const parsed = await parseBody(req, userUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await updateUser(
    id,
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req),
    resolved?.sessionId
  );
  if (!result.ok) return apiError(result.error, 400, "UPDATE_REJECTED");

  return apiOk({ user: result.user });
}
