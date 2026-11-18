import { NextRequest } from "next/server";
import { z } from "zod";
import { apiOk, apiError, assertSameOrigin, parseBody, requirePermission, requestMeta } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getRagOverview } from "@/lib/rag/admin";
import { updateRagEngineSettings } from "@/lib/rag/config";
import { enqueueJob } from "@/lib/rag/jobs";

export const dynamic = "force-dynamic";

/**
 * RAG engine admin API (task §11).
 *   GET  /api/admin/rag        — overview snapshot (settings, index health,
 *                                job queue, traces, evaluation runs).
 *   PUT  /api/admin/rag        — partial settings update (zod-validated,
 *                                audited; no provider credentials involved).
 *   POST /api/admin/rag        — enqueue a background job
 *                                (reembed-scope | reingest-document).
 */

/** GET — the full admin snapshot. */
export async function GET() {
  const guard = await requirePermission("ai.settings.access");
  if (!guard.ok) return guard.response;

  try {
    const overview = await getRagOverview();
    return apiOk(overview);
  } catch (error) {
    console.error("[api/admin/rag] GET failed:", error);
    return apiError("خطای غیرمنتظره در دریافت وضعیت موتور دانش.", 500);
  }
}

const updateSchema = z.object({
  embeddings: z
    .object({
      provider: z.enum(["builtin-hashed", "openai-compatible"]).optional(),
      model: z.string().trim().min(1).max(100).optional(),
      dim: z.number().int().min(64).max(4096).optional(),
    })
    .optional(),
  retrieval: z
    .object({
      candidateK: z.number().int().min(5).max(80).optional(),
      finalTopK: z.number().int().min(1).max(12).optional(),
      rrfK: z.number().int().min(10).max(120).optional(),
      lexicalFloor: z.number().min(0).max(1).optional(),
      semanticFloor: z.number().min(0).max(1).optional(),
      parentExpansion: z.boolean().optional(),
      parentExpansionLimit: z.number().int().min(0).max(6).optional(),
      maxContextChars: z.number().int().min(2000).max(60000).optional(),
    })
    .optional(),
  rerank: z
    .object({
      mode: z.enum(["off", "heuristic", "llm"]).optional(),
      rerankCandidates: z.number().int().min(5).max(50).optional(),
      llmTimeoutMs: z.number().int().min(2000).max(30000).optional(),
    })
    .optional(),
  crag: z
    .object({
      enabled: z.boolean().optional(),
      maxCorrectiveRounds: z.number().int().min(0).max(3).optional(),
      maxLlmCallsPerTurn: z.number().int().min(2).max(20).optional(),
      deadlineMs: z.number().int().min(5000).max(120000).optional(),
      partialPromotion: z.number().min(0).max(1).optional(),
      insufficiencyFloor: z.number().min(0).max(1).optional(),
      clarifyOnPartial: z.boolean().optional(),
    })
    .optional(),
  generation: z
    .object({
      verifyCitations: z.boolean().optional(),
      verifyClaims: z.boolean().optional(),
      appendCitations: z.boolean().optional(),
    })
    .optional(),
});

/** PUT — validated partial settings update (audited). */
export async function PUT(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("ai.provider.configure");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, updateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const updated = await updateRagEngineSettings(parsed.data, guard.user.username);
    const meta = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "rag.settings.updated",
      entityType: "SystemSetting",
      entityId: "rag.engine",
      metadata: { patch: JSON.stringify(parsed.data).slice(0, 500) },
      ip: meta.ip ?? undefined,
      userAgent: meta.userAgent ?? undefined,
    });
    return apiOk(updated);
  } catch (error) {
    console.error("[api/admin/rag] PUT failed:", error);
    return apiError("به‌روزرسانی تنظیمات موتور دانش ناموفق بود.", 500);
  }
}

const jobSchema = z.object({
  action: z.enum(["reembed-scope", "reingest-document"]),
  documentId: z.string().max(64).optional(),
  collectionId: z.string().max(64).optional(),
  all: z.boolean().optional(),
});

/** POST — enqueue background jobs (re-embed / re-ingest). */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("ai.provider.configure");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, jobSchema);
  if (!parsed.ok) return parsed.response;

  const { action, documentId, collectionId, all } = parsed.data;
  if (action === "reembed-scope" && !all && !documentId && !collectionId) {
    return apiError("دامنه امبدینگ مجدد را مشخص کنید (سند، مجموعه یا کل).", 422);
  }
  if (action === "reingest-document" && !documentId) {
    return apiError("شناسه سند برای پردازش مجدد الزامی است.", 422);
  }

  try {
    const jobId = await enqueueJob(
      action === "reembed-scope" ? "REEMBED_SCOPE" : "REINDEX_DOCUMENT",
      action === "reembed-scope" ? { all: all === true, documentId, collectionId } : { documentId }
    );
    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "rag.job.enqueued",
      entityType: "RagJob",
      entityId: jobId,
      metadata: { action, documentId, collectionId, all: all === true },
    });
    return apiOk({ jobId });
  } catch (error) {
    console.error("[api/admin/rag] POST failed:", error);
    return apiError("ثبت کار پس‌زمینه ناموفق بود.", 500);
  }
}
