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
import { resolveValidDepartmentIds, kbCollectionCreateSchema } from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/kb/collections — full management list (incl. inactive),
 * ordered by name.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("kb.view");
  if (!guard.ok) return guard.response;

  try {
    const collections = await db.knowledgeCollection.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { documents: true } },
        departmentGrants: {
          include: { department: { select: { id: true, name: true } } },
        },
      },
    });

    return apiOk({
      collections: collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        description: collection.description,
        access: collection.access,
        isActive: collection.isActive,
        documentCount: collection._count.documents,
        departments: collection.departmentGrants.map((grant) => ({
          id: grant.department.id,
          name: grant.department.name,
        })),
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[api/admin/kb/collections] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/** POST /api/admin/kb/collections — create a knowledge collection. */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.collections.manage");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, kbCollectionCreateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const departmentIds = await resolveValidDepartmentIds(parsed.data.departmentIds ?? []);

    const collection = await db.knowledgeCollection.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        access: parsed.data.access,
        departmentGrants: {
          create: departmentIds.map((departmentId) => ({ departmentId })),
        },
      },
    });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.collection.created",
      entityType: "KnowledgeCollection",
      entityId: collection.id,
      metadata: { collectionId: collection.id, name: collection.name, access: collection.access, departments: departmentIds.length },
      ip,
      userAgent,
    });

    return apiOk({ collection }, { status: 201 });
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "KB_VALIDATION_ERROR");
    }
    console.error("[api/admin/kb/collections] create failed:", error);
    return apiError("ایجاد مجموعه دانش ناموفق بود.", 500, "CREATE_FAILED");
  }
}
