import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { createUser, listUsers } from "@/lib/admin/users";
import { userCreateSchema } from "@/lib/validators";
import { db } from "@/lib/db";

/**
 * GET /api/admin/users — operator management list plus the reference data the
 * management UI needs (roles, departments, role bindings). Kept under a single
 * permission (`admin.users.manage`) so role/department dropdowns do not force
 * extra permissions just to render.
 */
export async function GET() {
  const guard = await requirePermission("admin.users.manage");
  if (!guard.ok) return guard.response;

  const [users, roles, departments, bindings] = await Promise.all([
    listUsers(),
    db.role.findMany({
      orderBy: [{ isSystem: "desc" }, { key: "asc" }],
      select: { key: true, name: true, isSystem: true },
    }),
    db.department.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true },
    }),
    db.rolePermission.findMany({
      select: { roleKey: true, permissionKey: true },
    }),
  ]);

  const roleBindings: Record<string, string[]> = {};
  for (const b of bindings) {
    (roleBindings[b.roleKey] ??= []).push(b.permissionKey);
  }

  return apiOk({ users, roles, departments, roleBindings });
}

/** POST /api/admin/users — create a staff account. */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.users.manage");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, userCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createUser(
    parsed.data,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "CREATE_REJECTED");

  return apiOk({ userId: result.userId }, { status: 201 });
}
