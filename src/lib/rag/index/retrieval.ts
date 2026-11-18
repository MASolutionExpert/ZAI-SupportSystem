import "server-only";

import type { AccessScope, Evidence, RagQuery, RagStrategy } from "@/lib/rag/types";
import type { Budget } from "@/lib/rag/budget";
import { getRagEngineSettings } from "@/lib/rag/config";
import { lexicalRetrieve } from "./lexical";
import { createVectorIndex, type VectorSearchResult } from "./vector";
import { rrfFuse, type RankedSource } from "./fusion";
import { expandParents } from "./parents";
import { expandQuery, effectiveQueries } from "@/lib/rag/query/transform";

/**
 * RAG Engine — retrieval execution facade (Stage 3).
 *
 * One round executes a chosen strategy and returns fused, reranked evidence.
 * Strategy semantics:
 *   FAST_QA    → lexical only, small topK (authoritative Q&A shortcut)
 *   LEXICAL    → lexical only
 *   SEMANTIC   → vector only (lexicalFloor bypassed via semantic floor)
 *   HYBRID     → lexical + vector fused with RRF, parent expansion
 *   MULTI_QUERY→ expansions + hybrid per query, unioned via RRF
 *   DECOMPOSE  → sub-queries retrieved independently (caller merges evidence)
 *
 * All executions are access-scoped inside the retrievers — this facade never
 * relaxes scoping.
 */

export type RetrievalRoundResult = {
  strategy: RagStrategy;
  queries: string[];
  evidence: Evidence[];
  candidatesScanned: number;
  vector: VectorSearchResult | null;
  parentExpansions: number;
  incompatibleSkipped: number;
};

export async function executeRetrievalRound(
  strategy: RagStrategy,
  query: RagQuery,
  scope: AccessScope,
  budget: Budget
): Promise<RetrievalRoundResult> {
  const settings = await getRagEngineSettings();
  const retrieval = settings.retrieval;
  const vectorIndex = createVectorIndex();

  const queries = effectiveQueries(query);
  const baseQueries =
    strategy === "MULTI_QUERY"
      ? [...queries, ...query.expansions].slice(0, 4)
      : strategy === "DECOMPOSE" && query.subQueries.length > 0
        ? query.subQueries
        : queries;

  const lexicalLists: RankedSource[][] = [];
  const vectorLists: RankedSource[][] = [];
  let candidatesScanned = 0;
  let vectorResult: VectorSearchResult | null = null;
  let incompatibleSkipped = 0;
  let wantVector =
    strategy === "HYBRID" || strategy === "MULTI_QUERY" || strategy === "SEMANTIC" || strategy === "DECOMPOSE";

  for (const queryText of baseQueries) {
    if (strategy !== "SEMANTIC") {
      const lexical = await lexicalRetrieve(queryText, scope, {
        topK: strategy === "FAST_QA" ? 5 : retrieval.candidateK,
        floor: retrieval.lexicalFloor,
      });
      candidatesScanned += lexical.candidatesScanned;
      lexicalLists.push(
        lexical.evidence.map((evidence, rank) => ({ evidence, rank }))
      );
    }

    if (wantVector) {
      const result = await vectorIndex.search(queryText, scope, {
        topK: retrieval.candidateK,
        floor: retrieval.semanticFloor,
      });
      candidatesScanned += result.candidatesScanned;
      incompatibleSkipped = Math.max(incompatibleSkipped, result.incompatibleSkipped);
      vectorResult = result;
      if (strategy !== "LEXICAL") {
        vectorLists.push(result.evidence.map((evidence, rank) => ({ evidence, rank })));
      }
    }
  }

  // ------------------------------------------------------------- fusion
  let fused: Evidence[];
  if (strategy === "LEXICAL" || strategy === "FAST_QA") {
    fused = lexicalLists.flat().map((s) => s.evidence);
  } else if (strategy === "SEMANTIC") {
    fused = vectorLists.flat().map((s) => s.evidence);
  } else {
    fused = rrfFuse([...lexicalLists, ...vectorLists], { k: retrieval.rrfK });
  }

  // Deduplicate by id (multi-query can retrieve the same chunk twice).
  const unique = new Map<string, Evidence>();
  for (const evidence of fused) {
    const existing = unique.get(evidence.id);
    if (!existing || evidence.score > existing.score) unique.set(evidence.id, evidence);
  }
  fused = Array.from(unique.values());

  // ------------------------------------------------------------- parents
  let parentExpansions = 0;
  if (retrieval.parentExpansion && strategy !== "FAST_QA") {
    const result = await expandParents(
      fused.slice(0, retrieval.parentExpansionLimit * 2),
      retrieval.parentExpansionLimit
    );
    const expandedIds = new Set(result.expanded.filter((e) => e.parentText).map((e) => e.id));
    parentExpansions = result.expandedCount;
    fused = fused.map((e) => {
      const replacement = result.expanded.find((r) => r.id === e.id);
      return replacement && expandedIds.has(e.id) ? replacement : e;
    });
  }

  return {
    strategy,
    queries: baseQueries,
    evidence: fused.slice(0, Math.max(settings.rerank.rerankCandidates, retrieval.finalTopK)),
    candidatesScanned,
    vector: vectorResult,
    parentExpansions,
    incompatibleSkipped,
  };
}

/** Multi-query expansion helper used by the controller (budget-guarded). */
export async function ensureExpansions(
  query: RagQuery,
  scope: AccessScope,
  budget: Budget
): Promise<RagQuery> {
  if (query.expansions.length === 0) {
    query.expansions = await expandQuery(query, budget);
  }
  void scope;
  return query;
}
