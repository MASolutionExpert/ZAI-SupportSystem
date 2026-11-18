import { NextRequest } from "next/server";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  parseBody,
  requestMeta,
  requirePermission,
} from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { KbInputError } from "@/lib/kb/pipeline";
import { kbQaDepartmentsSchema, resolveValidDepartmentIds } from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/admin/kb/qa/[id]/departments — replace the department assignment
 * set of a Q&A entry (atomic replace inside a transaction).
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.departments.assign");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, kbQaDepartmentsSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const entry = await db.knowledgeQaEntry.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!entry) {
      return apiError("مورد پرسش و پاسخ یافت نشد.", 404, "NOT_FOUND");
    }

    const departmentIds = await resolveValidDepartmentIds(parsed.data.departmentIds);

    await db.$transaction(async (tx) => {
      await tx.knowledgeQaDepartment.deleteMany({ where: { entryId: id } });
      await tx.knowledgeQaDepartment.createMany({
        data: departmentIds.map((departmentId) => ({ entryId: id, departmentId })),
      });
    });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.qa.departments.assigned",
      entityType: "KnowledgeQaEntry",
      entityId: id,
      metadata: { entryId: id, count: departmentIds.length },
      ip,
      userAgent,
    });

    return apiOk({ assigned: departmentIds.length });
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "KB_VALIDATION_ERROR");
    }
    console.error("[api/admin/kb/qa/[id]/departments] assign failed:", error);
    return apiError("انتساب دپارتمان‌ها به پرسش و پاسخ ناموفق بود.", 500, "ASSIGN_FAILED");
  }
}
