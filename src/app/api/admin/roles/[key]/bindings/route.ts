import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { setRoleBindings } from "@/lib/admin/roles";
import { roleBindingsPutSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ key: string }> };

/** PUT /api/admin/roles/[key]/bindings — replace permission bindings. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.permissions.manage");
  if (!guard.ok) return guard.response;

  const { key } = await ctx.params;
  const parsed = await parseBody(req, roleBindingsPutSchema);
  if (!parsed.ok) return parsed.response;

  const result = await setRoleBindings(
    decodeURIComponent(key),
    parsed.data.permissionKeys,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "BINDINGS_REJECTED");

  return apiOk({ saved: true, count: result.count });
}
