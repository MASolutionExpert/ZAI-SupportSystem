import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { getEffectivePermissions } from "@/lib/rbac/service";
import { hasDepartmentAccess } from "@/lib/rbac/scope";
import { ACTIVE_WORKLOAD_STATUSES } from "@/lib/tickets/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/staff/tickets/[id]/assignees — eligible operators for THIS ticket's
 * department: ACTIVE + available members holding "tickets.reply", with their
 * active workload (tickets in ACTIVE_WORKLOAD_STATUSES in that department).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("tickets.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const ticket = await db.ticket.findUnique({
      where: { id },
      select: { id: true, departmentId: true },
    });
    if (!ticket) return apiError("تیکت یافت نشد.", 404);

    const inScope = await hasDepartmentAccess(auth.user.id, ticket.departmentId);
    if (!inScope) return apiError("به این تیکت دسترسی ندارید.", 403);

    const members = await db.departmentMembership.findMany({
      where: {
        departmentId: ticket.departmentId,
        user: { status: "ACTIVE", isAvailable: true },
      },
      select: { userId: true, user: { select: { name: true, username: true } } },
      orderBy: { user: { name: "asc" } },
    });

    const eligible: Array<{ id: string; name: string; activeLoad: number }> = [];
    for (const m of members) {
      const perms = await getEffectivePermissions(m.userId);
      if (!perms.has("tickets.reply")) continue;
      eligible.push({
        id: m.userId,
        name: m.user.name || m.user.username,
        activeLoad: 0,
      });
    }
    if (eligible.length === 0) return apiOk({ assignees: [] });

    const loads = await db.ticket.groupBy({
      by: ["assignedToId"],
      where: {
        departmentId: ticket.departmentId,
        status: { in: [...ACTIVE_WORKLOAD_STATUSES] },
        assignedToId: { in: eligible.map((e) => e.id) },
      },
      _count: { assignedToId: true },
    });
    const loadMap = new Map(loads.map((l) => [l.assignedToId, l._count.assignedToId]));

    return apiOk({
      assignees: eligible.map((e) => ({ ...e, activeLoad: loadMap.get(e.id) ?? 0 })),
    });
  } catch (error) {
    console.error("[api/staff/tickets/[id]/assignees] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
