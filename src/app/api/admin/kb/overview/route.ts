import { NextRequest } from "next/server";
import { apiError, apiOk, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type StatusCounts = Record<string, number>;

async function countByStatus(
  model: "knowledgeDocument" | "knowledgeQaEntry"
): Promise<StatusCounts> {
  const groups =
    model === "knowledgeDocument"
      ? await db.knowledgeDocument.groupBy({ by: ["status"], _count: { _all: true } })
      : await db.knowledgeQaEntry.groupBy({ by: ["status"], _count: { _all: true } });
  const counts: StatusCounts = {};
  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return counts;
}

/**
 * GET /api/admin/kb/overview — dashboard counters for the knowledge base.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission("kb.view");
  if (!guard.ok) return guard.response;

  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      docStatus,
      qaStatus,
      collectionsTotal,
      collectionsActive,
      chunksTotal,
      retrievalsAnswered,
      retrievalsAbstained,
    ] = await Promise.all([
      countByStatus("knowledgeDocument"),
      countByStatus("knowledgeQaEntry"),
      db.knowledgeCollection.count(),
      db.knowledgeCollection.count({ where: { isActive: true } }),
      db.knowledgeChunk.count(),
      db.knowledgeRetrievalRecord.count({
        where: { decision: { startsWith: "ANSWERED" }, createdAt: { gte: since } },
      }),
      db.knowledgeRetrievalRecord.count({
        where: { decision: { startsWith: "ABSTAINED" }, createdAt: { gte: since } },
      }),
    ]);

    const documentsTotal = Object.values(docStatus).reduce((sum, n) => sum + n, 0);
    const qaTotal = Object.values(qaStatus).reduce((sum, n) => sum + n, 0);

    return apiOk({
      documents: {
        total: documentsTotal,
        indexed: docStatus["INDEXED"] ?? 0,
        failed: docStatus["FAILED"] ?? 0,
        processing: docStatus["PROCESSING"] ?? 0,
        disabled: docStatus["DISABLED"] ?? 0,
        uploaded: docStatus["UPLOADED"] ?? 0,
      },
      qaEntries: {
        total: qaTotal,
        published: qaStatus["PUBLISHED"] ?? 0,
        draft: qaStatus["DRAFT"] ?? 0,
        disabled: qaStatus["DISABLED"] ?? 0,
      },
      collections: {
        total: collectionsTotal,
        active: collectionsActive,
      },
      chunks: {
        total: chunksTotal,
      },
      retrievals: {
        last7d: {
          answered: retrievalsAnswered,
          abstained: retrievalsAbstained,
        },
      },
    });
  } catch (error) {
    console.error("[api/admin/kb/overview] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
