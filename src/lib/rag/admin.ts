import "server-only";

import { db } from "@/lib/db";
import { getRagEngineSettings, type RagEngineSettings } from "@/lib/rag/config";
import { jobStats } from "@/lib/rag/jobs";

/**
 * RAG Engine — admin overview aggregation (task §11).
 *
 * One snapshot for the admin engine panel: index health (documents by status,
 * chunks, embedding coverage + model/dim mismatch counts), job queue state,
 * recent failures, evaluation runs and the effective settings. Provider
 * credentials never pass through here (they live in the AI settings service).
 */

export type RagOverview = {
  settings: RagEngineSettings;
  documents: { total: number; indexed: number; processing: number; failed: number; disabled: number; uploaded: number };
  chunks: {
    total: number;
    sections: number;
    paragraphs: number;
    embedded: number;
    embeddingModels: Array<{ model: string; dim: number | null; count: number }>;
  };
  jobs: Awaited<ReturnType<typeof jobStats>>;
  traces: {
    total: number;
    answered: number;
    abstain: number;
    clarify: number;
    conflictDetected: number;
    budgetExceeded: number;
    recent: Array<{
      id: string;
      query: string;
      strategy: string;
      decision: string;
      iterations: number;
      llmCalls: number;
      durationMs: number;
      conflictDetected: boolean;
      supersededExcluded: boolean;
      budgetExceeded: boolean;
      createdAt: Date;
    }>;
  };
  evalRuns: Array<{
    id: string;
    datasetId: string;
    engineVersion: string;
    total: number;
    passed: number;
    failed: number;
    createdAt: Date;
  }>;
};

export async function getRagOverview(): Promise<RagOverview> {
  const [settings, documentsByStatus, chunkAgg, models, jobs, traceAgg, recentTraces, evalRuns] =
    await Promise.all([
      getRagEngineSettings(),
      db.knowledgeDocument.groupBy({ by: ["status"], _count: { status: true } }),
      db.knowledgeChunk.aggregate({ _count: { id: true } }),
      db.knowledgeChunk.groupBy({
        by: ["embeddingModel", "embeddingDim"],
        where: { embeddingModel: { not: null } },
        _count: { id: true },
      }),
      jobStats(),
      db.ragTrace.groupBy({ by: ["decision"], _count: { decision: true } }),
      db.ragTrace.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          query: true,
          strategy: true,
          decision: true,
          iterations: true,
          llmCalls: true,
          durationMs: true,
          conflictDetected: true,
          supersededExcluded: true,
          budgetExceeded: true,
          createdAt: true,
        },
      }),
      db.ragEvalRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          datasetId: true,
          engineVersion: true,
          total: true,
          passed: true,
          failed: true,
          createdAt: true,
        },
      }),
    ]);

  const statusCount = (status: string) =>
    documentsByStatus.find((row) => row.status === status)?._count.status ?? 0;

  const decisionCount = (decision: string) =>
    traceAgg.find((row) => row.decision === decision)?._count.decision ?? 0;

  const [sections, paragraphs, embedded, conflictDetected, budgetExceeded, traceTotal] =
    await Promise.all([
      db.knowledgeChunk.count({ where: { kind: "SECTION" } }),
      db.knowledgeChunk.count({ where: { kind: "PARAGRAPH" } }),
      db.knowledgeChunk.count({ where: { embedding: { not: null } } }),
      db.ragTrace.count({ where: { conflictDetected: true } }),
      db.ragTrace.count({ where: { budgetExceeded: true } }),
      db.ragTrace.count(),
    ]);

  return {
    settings,
    documents: {
      total: documentsByStatus.reduce((sum, row) => sum + row._count.status, 0),
      indexed: statusCount("INDEXED"),
      processing: statusCount("PROCESSING"),
      failed: statusCount("FAILED"),
      disabled: statusCount("DISABLED"),
      uploaded: statusCount("UPLOADED"),
    },
    chunks: {
      total: chunkAgg._count.id,
      sections,
      paragraphs,
      embedded,
      embeddingModels: models.map((row) => ({
        model: row.embeddingModel ?? "n/a",
        dim: row.embeddingDim,
        count: row._count.id,
      })),
    },
    jobs,
    traces: {
      total: traceTotal,
      answered: decisionCount("ANSWERED"),
      abstain: decisionCount("ABSTAIN"),
      clarify: decisionCount("CLARIFY"),
      conflictDetected,
      budgetExceeded,
      recent: recentTraces,
    },
    evalRuns,
  };
}
