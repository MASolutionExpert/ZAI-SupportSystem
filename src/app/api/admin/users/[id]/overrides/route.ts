import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { setUserOverrides } from "@/lib/admin/users";
import { overridesPutSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/users/[id]/overrides — current ALLOW/DENY exceptions. */
export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requirePermission("admin.permissions.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const overrides = await db.userPermissionOverride.findMany({
    where: { userId: id },
    select: { permissionKey: true, effect: true, note: true },
    orderBy: { permissionKey: "asc" },
  });

  return apiOk({ overrides });
}

/** PUT /api/admin/users/[id]/overrides — replace ALLOW/DENY exceptions. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.permissions.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, overridesPutSchema);
  if (!parsed.ok) return parsed.response;

  const result = await setUserOverrides(
    id,
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "OVERRIDES_REJECTED");

  return apiOk({ saved: true });
}
