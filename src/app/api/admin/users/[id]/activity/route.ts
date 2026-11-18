import {
  apiError,
  apiOk,
  requirePermission,
} from "@/lib/api";
import { getUserActivity } from "@/lib/admin/users";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/users/[id]/activity — workload/activity snapshot. */
export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requirePermission("admin.users.manage");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const activity = await getUserActivity(id);
  if (!activity) return apiError("کاربر یافت نشد.", 404, "NOT_FOUND");

  return apiOk(activity);
}
