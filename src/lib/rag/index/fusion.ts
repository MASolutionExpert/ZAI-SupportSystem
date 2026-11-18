/**
 * RAG Engine — rank fusion (task §4.C).
 *
 * Reciprocal Rank Fusion: each ranked list contributes 1 / (k + rank) per
 * element. RRF is rank-based, so incomparable score scales (lexical 0..1 vs
 * cosine 0..1 vs LLM grades) never corrupt the fusion — a real failure mode of
 * naive weighted concatenation. Component scores are preserved on the evidence
 * for observability; `score` after fusion is the normalized RRF share.
 */

import { clamp01, type Evidence } from "@/lib/rag/types";

export type RankedSource = {
  evidence: Evidence;
  rank: number; // 0-based rank within its list
};

export type FusionOptions = {
  /** Standard RRF k (60) — dampens the influence of top ranks. */
  k?: number;
};

export function rrfFuse(
  lists: RankedSource[][],
  options?: FusionOptions
): Evidence[] {
  const k = options?.k ?? 60;
  const maxPossible = lists.length * (1 / (k + 1));

  const fused = new Map<string, { evidence: Evidence; rrf: number }>();
  for (const list of lists) {
    for (const { evidence, rank } of list) {
      const entry = fused.get(evidence.id);
      const contribution = 1 / (k + rank + 1);
      if (entry) {
        entry.rrf += contribution;
        // Keep the richest provenance (first sight wins for component scores).
        entry.evidence = mergeEvidence(entry.evidence, evidence);
      } else {
        fused.set(evidence.id, { evidence: { ...evidence }, rrf: contribution });
      }
    }
  }

  const out = Array.from(fused.values()).map(({ evidence, rrf }) => ({
    ...evidence,
    score: clamp01(maxPossible > 0 ? rrf / maxPossible : 0),
  }));

  out.sort((a, b) => b.score - a.score);
  return out;
}

/** First-sight evidence wins; fill missing fields from duplicates. */
function mergeEvidence(primary: Evidence, secondary: Evidence): Evidence {
  return {
    ...primary,
    lexicalScore: primary.lexicalScore || secondary.lexicalScore,
    semanticScore: primary.semanticScore ?? secondary.semanticScore,
    parentText: primary.parentText ?? secondary.parentText,
  };
}
