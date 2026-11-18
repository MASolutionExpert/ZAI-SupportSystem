import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { createRole, listRoles } from "@/lib/admin/roles";
import { roleCreateSchema } from "@/lib/validators";

/** GET /api/admin/roles — roles with bindings + user counts. */
export async function GET() {
  const guard = await requirePermission("admin.roles.manage");
  if (!guard.ok) return guard.response;

  const roles = await listRoles();
  return apiOk({ roles });
}

/** POST /api/admin/roles — create a custom role. */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.roles.manage");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, roleCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createRole(
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "CREATE_REJECTED");

  return apiOk({ roleKey: result.roleKey }, { status: 201 });
}
