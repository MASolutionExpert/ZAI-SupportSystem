import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  parseBody,
  requirePermission,
} from "@/lib/api";
import {
  deleteCitizenByAdmin,
  getCitizenForAdmin,
  updateCitizenByAdmin,
} from "@/lib/customers/accounts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  fullName: z.string().min(3).max(80).optional(),
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
});

/**
 * GET /api/admin/citizens/[id] — full management detail (profile + tickets +
 * conversations). Requires `admin.citizens.manage`.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const auth = await requirePermission("admin.citizens.manage");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const citizen = await getCitizenForAdmin(id);
    if (!citizen) {
      return apiError("کاربر یافت نشد.", 404, "NOT_FOUND");
    }
    return apiOk({ citizen });
  } catch (error) {
    console.error("[api/admin/citizens/[id]] get failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * PATCH /api/admin/citizens/[id] — edit display name and/or status
 * (ACTIVE ⇄ BLOCKED). Audited.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const auth = await requirePermission("admin.citizens.manage");
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const { id } = await ctx.params;
    const result = await updateCitizenByAdmin({
      actorId: auth.user.id,
      actorLabel: auth.user.name || auth.user.username,
      citizenId: id,
      fullName: parsed.data.fullName,
      status: parsed.data.status,
    });
    if (!result.ok) return apiError(result.error, result.status);
    return apiOk({ citizen: result.citizen });
  } catch (error) {
    console.error("[api/admin/citizens/[id]] patch failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * DELETE /api/admin/citizens/[id] — delete the citizen account. Their
 * tickets/conversations survive (customerId is SetNull by schema);
 * notifications cascade. Audited with the preserved-records note.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const auth = await requirePermission("admin.citizens.manage");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const result = await deleteCitizenByAdmin({
      actorId: auth.user.id,
      actorLabel: auth.user.name || auth.user.username,
      citizenId: id,
    });
    if (!result.ok) return apiError(result.error, result.status);
    return apiOk({ deleted: true });
  } catch (error) {
    console.error("[api/admin/citizens/[id]] delete failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
