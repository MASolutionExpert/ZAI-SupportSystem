import "server-only";

import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";
import type { Citation, Evidence, RagAnswerStatus, RagResult, RagTraceData } from "@/lib/rag/types";

/**
 * RAG Engine — trace + legacy-record persistence.
 *
 * Every engine turn writes:
 *  1. a full `RagTrace` (strategy, iterations, corrective actions, budgets,
 *     conflict/supersession flags) — the admin trace viewer + eval source;
 *  2. a summary `KnowledgeRetrievalRecord` (existing reports stay functional).
 * Customer questions persist in the internal audit copy exactly as the legacy
 * pipeline did; citations stored on the trace are customer-safe renderings.
 */

export async function persistTurnResult(input: {
  conversationId?: string;
  departmentId: string;
  query: string;
  result: RagResult;
}): Promise<void> {
  const trace: RagTraceData = input.result.trace;
  const citations: Citation[] = input.result.citations;
  const evidence: Evidence[] = input.result.evidence;

  const tracePayload = {
    strategy: trace.strategy,
    iterations: trace.iterations,
    correctiveActions: trace.correctiveActions,
    llmCalls: trace.llmCalls,
    durationMs: trace.durationMs,
    budgetExceeded: trace.budgetExceeded,
    embeddingModel: trace.embeddingModel,
  };

  try {
    await db.ragTrace.create({
      data: {
        conversationId: input.conversationId ?? null,
        departmentId: input.departmentId,
        query: input.query.slice(0, 2000),
        strategy: input.result.strategy,
        decision: input.result.status,
        iterations: trace.iterations.length,
        llmCalls: trace.llmCalls,
        durationMs: trace.durationMs,
        finalConfidence: input.result.confidence,
        correctiveActions: JSON.stringify(tracePayload.correctiveActions ?? []),
        evidence: JSON.stringify(
          evidence.map((e) => ({
            id: e.id,
            kind: e.kind,
            score: Number(e.score.toFixed(4)),
            title: e.kind === "QA" ? e.qaQuestion ?? "" : e.documentTitle,
            page: e.page,
            section: e.headingPath,
            documentId: e.documentId,
            versionNo: e.documentVersionNo,
          }))
        ),
        citations: JSON.stringify(citations),
        conflictDetected: input.result.conflictDetected,
        supersededExcluded: input.result.trace.supersededExcluded,
        embeddingModel: trace.embeddingModel,
        budgetExceeded: trace.budgetExceeded,
      },
    });
  } catch (error) {
    console.error("[rag/trace] RagTrace persistence failed:", error);
  }

  try {
    await db.knowledgeRetrievalRecord.create({
      data: {
        conversationId: input.conversationId ?? null,
        departmentId: input.departmentId,
        queryDigest: sha256Hex(input.query).slice(0, 32),
        queryText: input.query.slice(0, 2000),
        decision:
          input.result.status === "ANSWERED"
            ? "ANSWERED"
            : input.result.status === "CLARIFY"
              ? "ABSTAINED_LOW_SCORE"
              : "ABSTAINED_NO_EVIDENCE",
        topScore: input.result.confidence,
        sources: JSON.stringify(input.result.recordSources),
      },
    });
  } catch (error) {
    console.error("[rag/trace] legacy retrieval record persistence failed:", error);
  }
}

/** Status union kept explicit for callers. */
export type TraceStatus = RagAnswerStatus;
