import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import {
  createDepartment,
  listDepartments,
} from "@/lib/admin/departments";
import { departmentCreateSchema } from "@/lib/validators";

/** GET /api/admin/departments — full management list (incl. inactive). */
export async function GET() {
  const guard = await requirePermission("admin.departments.manage");
  if (!guard.ok) return guard.response;

  const departments = await listDepartments();
  return apiOk({ departments });
}

/** POST /api/admin/departments — create a department. */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.departments.manage");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, departmentCreateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const department = await createDepartment(
      parsed.data,
      { id: guard.user.id, username: guard.user.username },
      requestMeta(req)
    );
    return apiOk({ department }, { status: 201 });
  } catch (error) {
    console.error("[api/admin/departments] create failed:", error);
    return apiError("ایجاد دپارتمان ناموفق بود.", 500, "CREATE_FAILED");
  }
}
