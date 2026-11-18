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
import { can } from "@/lib/rbac/service";
import { db } from "@/lib/db";
import { KbInputError } from "@/lib/kb/pipeline";
import { serializeQaEntry } from "@/lib/kb/serialize";
import {
  kbQaCreateSchema,
  resolveValidDepartmentIds,
} from "@/lib/kb/validators";

export const dynamic = "force-dynamic";

const QA_INCLUDE = {
  createdBy: { select: { name: true } },
  alternates: { select: { id: true, question: true } },
  departments: { include: { department: { select: { id: true, name: true } } } },
} as const;

/**
 * GET /api/admin/kb/qa — curated Q&A management list (all statuses),
 * newest updated first, max 200.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("kb.view");
  if (!guard.ok) return guard.response;

  try {
    const entries = await db.knowledgeQaEntry.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: QA_INCLUDE,
    });

    return apiOk({ entries: entries.map(serializeQaEntry) });
  } catch (error) {
    console.error("[api/admin/kb/qa] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/** POST /api/admin/kb/qa — create a curated Q&A entry. */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("kb.qa.create");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, kbQaCreateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    // Publishing straight on create additionally requires kb.qa.publish.
    if (parsed.data.status === "PUBLISHED") {
      const allowed = await can(guard.user.id, "kb.qa.publish");
      if (!allowed) {
        return apiError("برای انتشار مستقیم پرسش و پاسخ دسترسی لازم را ندارید.", 403, "FORBIDDEN");
      }
    }

    const departmentIds = await resolveValidDepartmentIds(parsed.data.departmentIds);

    const entry = await db.knowledgeQaEntry.create({
      data: {
        question: parsed.data.question,
        officialAnswer: parsed.data.officialAnswer,
        category: parsed.data.category ?? null,
        keywords: parsed.data.keywords?.length
          ? JSON.stringify(parsed.data.keywords)
          : null,
        status: parsed.data.status,
        createdById: guard.user.id,
        alternates: {
          create: (parsed.data.alternates ?? []).map((question) => ({ question })),
        },
        departments: {
          create: departmentIds.map((departmentId) => ({ departmentId })),
        },
      },
      include: QA_INCLUDE,
    });

    const { ip, userAgent } = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "kb.qa.created",
      entityType: "KnowledgeQaEntry",
      entityId: entry.id,
      metadata: {
        entryId: entry.id,
        status: entry.status,
        departments: departmentIds.length,
      },
      ip,
      userAgent,
    });

    return apiOk({ entry: serializeQaEntry(entry) }, { status: 201 });
  } catch (error) {
    if (error instanceof KbInputError) {
      return apiError(error.message, error.status, "KB_VALIDATION_ERROR");
    }
    console.error("[api/admin/kb/qa] create failed:", error);
    return apiError("ایجاد پرسش و پاسخ ناموفق بود.", 500, "CREATE_FAILED");
  }
}
