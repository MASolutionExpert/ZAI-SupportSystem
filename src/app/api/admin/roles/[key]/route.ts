import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { deleteRole, updateRole } from "@/lib/admin/roles";
import { roleUpdateSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ key: string }> };

/** PATCH /api/admin/roles/[key] — rename/edit custom roles only. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.roles.manage");
  if (!guard.ok) return guard.response;

  const { key } = await ctx.params;
  const parsed = await parseBody(req, roleUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await updateRole(
    decodeURIComponent(key),
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "UPDATE_REJECTED");

  return apiOk({ saved: true });
}

/** DELETE /api/admin/roles/[key] — custom roles without bound users only. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.roles.manage");
  if (!guard.ok) return guard.response;

  const { key } = await ctx.params;
  const result = await deleteRole(
    decodeURIComponent(key),
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "DELETE_REJECTED");

  return apiOk({ deleted: true });
}
