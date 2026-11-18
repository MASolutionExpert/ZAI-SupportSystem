import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { setUserMemberships } from "@/lib/admin/users";
import { membershipsPutSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/admin/users/[id]/memberships — replace department memberships. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.users.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, membershipsPutSchema);
  if (!parsed.ok) return parsed.response;

  const result = await setUserMemberships(
    id,
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "MEMBERSHIPS_REJECTED");

  return apiOk({ saved: true });
}
