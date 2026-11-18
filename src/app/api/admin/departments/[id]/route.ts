import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { deleteDepartment, updateDepartment } from "@/lib/admin/departments";
import { departmentUpdateSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/departments/[id] — partial update (toggles, fields). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.departments.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, departmentUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await updateDepartment(
    id,
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "UPDATE_REJECTED");

  return apiOk({ department: result.department });
}

/** DELETE /api/admin/departments/[id] — only for departments without members. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.departments.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const result = await deleteDepartment(
    id,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "DELETE_REJECTED");

  return apiOk({ deleted: true });
}
