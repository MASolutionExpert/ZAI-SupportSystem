import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { reorderDepartments } from "@/lib/admin/departments";
import { departmentReorderSchema } from "@/lib/validators";

/** POST /api/admin/departments/reorder — persist display order. */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.departments.manage");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, departmentReorderSchema);
  if (!parsed.ok) return parsed.response;

  const result = await reorderDepartments(
    parsed.data.orderedIds,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );
  if (!result.ok) return apiError(result.error, 400, "REORDER_REJECTED");

  return apiOk({ saved: true });
}
