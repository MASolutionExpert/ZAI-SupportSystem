/**
 * RAG Engine — evaluation metrics (task §10).
 *
 * Deterministic, replayable measurements over the acceptance dataset:
 *  - retrieval: Recall@K, Precision@K, MRR, nDCG@K (binary relevance), latency
 *  - answers:   abstention correctness, citation correctness, keyword support
 *
 * Gold evidence is matched at runtime by document title / Q&A question
 * fragments, so the dataset survives re-seeding. The runner never scores an
 * LLM's opinion of an answer — production LLM-judge faithfulness scoring is a
 * documented extension point, not a silently-claimed capability.
 */

import { clamp01 } from "@/lib/rag/types";

export type RetrievalGold = Set<string>; // evidence ids considered relevant

export function recallAtK(rankedIds: string[], gold: RetrievalGold, k: number): number {
  if (gold.size === 0) return 1; // nothing to find — not a retrieval failure
  const topK = rankedIds.slice(0, k);
  const hits = topK.filter((id) => gold.has(id)).length;
  return clamp01(hits / gold.size);
}

export function precisionAtK(rankedIds: string[], gold: RetrievalGold, k: number): number {
  const topK = rankedIds.slice(0, k);
  if (topK.length === 0) return 0;
  const hits = topK.filter((id) => gold.has(id)).length;
  return clamp01(hits / topK.length);
}

export function reciprocalRank(rankedIds: string[], gold: RetrievalGold): number {
  for (let i = 0; i < rankedIds.length; i++) {
    if (gold.has(rankedIds[i]!)) return 1 / (i + 1);
  }
  return 0;
}

export function ndcgAtK(rankedIds: string[], gold: RetrievalGold, k: number): number {
  // Binary relevance gain; IDCG = ideal ordering of the gold set.
  const dcg = rankedIds
    .slice(0, k)
    .reduce((acc, id, index) => acc + (gold.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const idealHits = Math.min(gold.size, k);
  const idcg = Array.from({ length: idealHits }, (_, i) => 1 / Math.log2(i + 2)).reduce(
    (a, b) => a + b,
    0
  );
  return idcg > 0 ? clamp01(dcg / idcg) : 0;
}

export type LatencySample = number;

export function summarizeLatency(samples: LatencySample[]): {
  avg: number;
  p50: number;
  p95: number;
  max: number;
} {
  if (samples.length === 0) return { avg: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1]!,
  };
}

// ---------------------------------------------------------------- answer checks --

export type AnswerCheckInput = {
  expectedStatus: "ANSWERED" | "CLARIFY" | "ABSTAIN";
  actualStatus: string;
  answerText: string;
  citations: Array<{ evidenceId: string }>;
  retrievedIds: string[];
  mustCite?: boolean;
  mustContainAny?: string[];
};

export type AnswerCheckResult = {
  passed: boolean;
  abstentionCorrect: boolean;
  citationsValid: boolean;
  keywordSupported: boolean;
  failures: string[];
};

export function checkAnswer(input: AnswerCheckInput): AnswerCheckResult {
  const failures: string[] = [];

  const abstentionCorrect =
    (input.expectedStatus === "ANSWERED" && input.actualStatus === "ANSWERED") ||
    (input.expectedStatus === "CLARIFY" &&
      (input.actualStatus === "CLARIFY" || input.actualStatus === "ABSTAIN")) ||
    (input.expectedStatus === "ABSTAIN" && input.actualStatus !== "ANSWERED");
  if (!abstentionCorrect) {
    failures.push(
      `وضعیت پاسخ نادرست: انتظار ${input.expectedStatus}، واقعی ${input.actualStatus}`
    );
  }

  // Citation correctness: every cited id must be part of the retrieved,
  // authorized evidence set (guards against hallucinated attributions).
  const retrievedSet = new Set(input.retrievedIds);
  const citationsValid =
    input.citations.length === 0
      ? !input.mustCite && input.expectedStatus !== "ANSWERED"
      : input.citations.every((c) => retrievedSet.has(c.evidenceId));
  if (!citationsValid) {
    failures.push("ارجاع‌ها به مدارک بازیابی‌شده تعلق ندارند.");
  }
  if (input.mustCite && input.expectedStatus === "ANSWERED" && input.citations.length === 0) {
    failures.push("پاسخ باید حداقل یک ارجاع داشته باشد.");
    // downgrade
  }

  let keywordSupported = true;
  if (input.expectedStatus === "ANSWERED" && input.mustContainAny && input.mustContainAny.length > 0) {
    keywordSupported = input.mustContainAny.some((keyword) => input.answerText.includes(keyword));
    if (!keywordSupported) {
      failures.push("پاسخ شامل هیچ‌یک از نشانه‌های محتوایی مورد انتظار نیست.");
    }
  }

  return {
    passed: failures.length === 0,
    abstentionCorrect,
    citationsValid,
    keywordSupported,
    failures,
  };
}
