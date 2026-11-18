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
import {
  kbCollectionDepartmentsSchema,
  resolveValidDepartmentIds,
} from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/admin/kb/collections/[id]/departments — replace the department
 * grant set of a collection (removed grants are deleted, added ones created,
 * atomically inside a transaction).
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.departments.assign");
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, kbCollectionDepartmentsSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const collection = await db.knowledgeCollection.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!collection) {
      return apiError("مجموعه دانش یافت نشد.", 404, "NOT_FOUND");
    }

    const departmentIds = await resolveValidDepartmentIds(parsed.data.departmentIds);

    await db.$transaction(async (tx) => {
      // Replace the grant set wholesale.
      await tx.knowledgeCollectionDepartment.deleteMany({ where: { collectionId: id } });
      if (departmentIds.length > 0) {
        await tx.knowledgeCollectionDepartment.createMany({
          data: departmentIds.map((departmentId) => ({ collectionId: id, departmentId })),
        });
      }
    });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.collection.departments.assigned",
      entityType: "KnowledgeCollection",
      entityId: id,
      metadata: { collectionId: id, count: departmentIds.length },
      ip,
      userAgent,
    });

    return apiOk({ assigned: departmentIds.length });
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "KB_VALIDATION_ERROR");
    }
    console.error("[api/admin/kb/collections/[id]/departments] assign failed:", error);
    return apiError("انتساب دپارتمان‌ها به مجموعه ناموفق بود.", 500, "ASSIGN_FAILED");
  }
}
