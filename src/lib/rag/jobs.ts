import "server-only";

/**
 * RAG Engine — DB-backed background job queue.
 *
 * Long-running document operations (re-indexing, bulk re-embedding after an
 * embedding-model change) run through this queue instead of blocking API
 * requests. Deliberately simple: one in-process runner polling PENDING rows
 * (SQLite's single connection makes the claim race-free), attempts with
 * exponential backoff, explicit FAILED terminal state with lastError. No new
 * infrastructure — the queue survives restarts because state is in the DB.
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ingestDocumentNow, reembedChunks, SYSTEM_INGEST_ACTOR } from "./ingest/pipeline";
import type { ReembedScope } from "./ingest/pipeline";

export type RagJobType = "INGEST_DOCUMENT" | "REINDEX_DOCUMENT" | "REEMBED_SCOPE";

const BACKOFF_MS = [10_000, 30_000, 120_000]; // per attempt index

export async function enqueueJob(
  type: RagJobType,
  payload: Record<string, unknown>,
  options?: { maxAttempts?: number }
): Promise<string> {
  const job = await db.ragJob.create({
    data: {
      type,
      payload: JSON.stringify(payload),
      maxAttempts: options?.maxAttempts ?? 3,
    },
    select: { id: true },
  });
  kickWorker();
  return job.id;
}

// ----------------------------------------------------------------- executor --

async function executeJob(type: RagJobType, payload: Record<string, unknown>): Promise<string> {
  switch (type) {
    case "INGEST_DOCUMENT":
    case "REINDEX_DOCUMENT": {
      const documentId = typeof payload.documentId === "string" ? payload.documentId : null;
      if (!documentId) throw new Error("شناسه سند در پارامتر کار یافت نشد.");
      const outcome = await ingestDocumentNow(documentId, SYSTEM_INGEST_ACTOR);
      if (outcome.status !== "INDEXED") {
        throw new Error(outcome.error ?? "پردازش سند ناموفق بود.");
      }
      return `document ${documentId} indexed (${outcome.chunks} chunks, model ${outcome.embeddingModel})`;
    }
    case "REEMBED_SCOPE": {
      const scope: ReembedScope = {
        documentId: typeof payload.documentId === "string" ? payload.documentId : undefined,
        collectionId: typeof payload.collectionId === "string" ? payload.collectionId : undefined,
        all: payload.all === true,
      };
      if (!scope.all && !scope.documentId && !scope.collectionId) {
        throw new Error("دامنه امبدینگ مجدد نامشخص است.");
      }
      const result = await reembedChunks(scope, SYSTEM_INGEST_ACTOR);
      return `re-embedded ${result.embedded}/${result.scanned} chunks (model ${result.model}, dim ${result.dim})`;
    }
    default:
      throw new Error(`نوع کار پشتیبانی نمی‌شود: ${type}`);
  }
}

// ------------------------------------------------------------------- runner --

let running = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Claim + execute due jobs until the queue drains. Safe to call concurrently
 * (module-level guard serializes within the process; SQLite serializes across).
 */
export async function runDueJobs(): Promise<number> {
  let processed = 0;
  for (;;) {
    const due = await db.ragJob.findFirst({
      where: { status: "PENDING", runAfter: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
    });
    if (!due) break;

    const claimed = await db.ragJob.updateMany({
      where: { id: due.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // another claimant won

    const attempts = due.attempts + 1;
    try {
      const payload = JSON.parse(due.payload) as Record<string, unknown>;
      const detail = await executeJob(due.type as RagJobType, payload);
      await db.ragJob.update({
        where: { id: due.id },
        data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null },
      });
      await audit({
        actorType: "SYSTEM",
        action: "rag.job.succeeded",
        entityType: "RagJob",
        entityId: due.id,
        metadata: { type: due.type, attempts, detail },
      });
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const willRetry = attempts < due.maxAttempts;
      await db.ragJob.update({
        where: { id: due.id },
        data: {
          status: willRetry ? "PENDING" : "FAILED",
          lastError: message.slice(0, 500),
          finishedAt: willRetry ? null : new Date(),
          runAfter: willRetry
            ? new Date(Date.now() + (BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 60000))
            : undefined,
        },
      });
      await audit({
        actorType: "SYSTEM",
        action: willRetry ? "rag.job.retry" : "rag.job.failed",
        entityType: "RagJob",
        entityId: due.id,
        metadata: { type: due.type, attempts, maxAttempts: due.maxAttempts, error: message.slice(0, 300) },
      });
      processed++;
    }
  }
  return processed;
}

async function workerLoop(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runDueJobs();
  } catch (error) {
    console.error("[rag/jobs] worker loop error:", error);
  } finally {
    running = false;
  }
}

/** Fire-and-forget kick after enqueue (no waiting on the API path). */
export function kickWorker(): void {
  void workerLoop();
}

/** Start the periodic poller — once per process (called from instrumentation). */
export function startRagWorker(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => kickWorker(), 5000);
  // Do not hold the event loop open on shutdown.
  if (typeof pollTimer.unref === "function") pollTimer.unref();
  kickWorker();
}

/** Queue stats for the admin overview. */
export async function jobStats(): Promise<{
  pending: number;
  running: number;
  failed: number;
  succeeded: number;
  recentFailed: Array<{ id: string; type: string; lastError: string | null; attempts: number; createdAt: Date }>;
}> {
  const [pending, runningCount, failed, succeeded, recentFailed] = await Promise.all([
    db.ragJob.count({ where: { status: "PENDING" } }),
    db.ragJob.count({ where: { status: "RUNNING" } }),
    db.ragJob.count({ where: { status: "FAILED" } }),
    db.ragJob.count({ where: { status: "SUCCEEDED" } }),
    db.ragJob.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, lastError: true, attempts: true, createdAt: true },
    }),
  ]);
  return { pending, running: runningCount, failed, succeeded, recentFailed };
}
