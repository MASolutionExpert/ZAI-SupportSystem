import "server-only";

import { tokenize, normalizePersian } from "@/lib/kb/text";
import { getActiveAdapter, AiDisabledError } from "@/lib/ai/adapter";
import { resolveChatModel, getAiGlobalSettings } from "@/lib/ai/settings";
import { clamp01, type Evidence } from "@/lib/rag/types";
import type { Budget } from "@/lib/rag/budget";
import { budgetExceeded, recordChatUsage } from "@/lib/rag/budget";

/**
 * RAG Engine — replaceable reranking layer (task §5).
 *
 * Retrieval is deliberately broad (candidateK per retriever); the reranker
 * orders candidates by actual relevance to the ORIGINAL question before the
 * evidence evaluator and generator see them. Reranking is NOT vector
 * similarity — the heuristic layer re-scores against the query with lexical
 * precision signals, and the optional LLM layer judges semantic relevance.
 *
 * Contract: never throws; on any failure the input order degrades gracefully.
 */

export interface Reranker {
  readonly id: string;
  rerank(question: string, candidates: Evidence[], budget: Budget): Promise<Evidence[]>;
}

// ------------------------------------------------------------- heuristic --

/**
 * Deterministic reranker: query-token precision on the evidence text (and its
 * parent expansion), heading-path affinity, Q&A authority, exact identifier
 * hits and a mild fusion-score prior. Zero latency, zero cost — the default.
 */
export class HeuristicReranker implements Reranker {
  readonly id = "heuristic-v1";

  async rerank(question: string, candidates: Evidence[], _budget: Budget): Promise<Evidence[]> {
    const normalized = normalizePersian(question);
    const tokens = Array.from(new Set(tokenize(normalized)));
    if (tokens.length === 0) return candidates;

    const rescored = candidates.map((candidate) => {
      const corpusText = normalizePersian(
        [
          candidate.text,
          candidate.parentText ?? "",
          candidate.qaQuestion ?? "",
          candidate.headingPath ?? "",
        ].join(" ")
      );
      const matched = tokens.filter((token) => corpusText.includes(token)).length;
      const coverage = matched / tokens.length;

      const headingAffinity = candidate.headingPath
        ? normalizePersian(candidate.headingPath).split(" ").filter((w) => tokens.includes(w)).length /
          Math.max(1, tokens.length)
        : 0;
      const authorityBoost = candidate.kind === "QA" ? 0.1 : 0;
      const parentBoost = candidate.parentText ? 0.04 : 0;

      const score = clamp01(
        0.55 * coverage +
          0.25 * candidate.score + // fused prior
          0.12 * headingAffinity +
          authorityBoost +
          parentBoost
      );
      return { ...candidate, score };
    });

    rescored.sort((a, b) => b.score - a.score);
    return rescored;
  }
}

// ------------------------------------------------------------------- LLM --

type LlmGrade = { id: string; relevance: number };

function parseGrades(text: string): LlmGrade[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const { id, relevance } = item as { id?: unknown; relevance?: unknown };
        if (typeof id !== "string" || typeof relevance !== "number") return null;
        return { id, relevance: Math.min(10, Math.max(0, relevance)) };
      })
      .filter((g): g is LlmGrade => g !== null);
  } catch {
    return [];
  }
}

const LLM_RERANK_TIMEOUT_MS = 8000;

/**
 * LLM relevance grading of the candidate set (one call for the whole batch).
 * The prompt sees only evidence TEXTS + the question — no system internals,
 * no access metadata. Falls back to heuristic ordering on any failure.
 */
export class LlmReranker implements Reranker {
  readonly id = "llm-relevance-v1";

  constructor(private readonly fallback: Reranker = new HeuristicReranker()) {}

  async rerank(question: string, candidates: Evidence[], budget: Budget): Promise<Evidence[]> {
    if (candidates.length < 2 || budgetExceeded(budget)) {
      return this.fallback.rerank(question, candidates, budget);
    }

    const listing = candidates
      .slice(0, 24)
      .map(
        (candidate, index) =>
          `${index + 1}. id=${candidate.id}\n   ${candidate.text.slice(0, 400).replace(/\s+/g, " ")}`
      )
      .join("\n");

    try {
      const { adapter } = await getActiveAdapter();
      const settings = await getAiGlobalSettings();
      const model = await resolveChatModel(settings);
      const outcome = await adapter.chat(
        model,
        [
          {
            role: "system",
            content:
              "تو ارزیاب رتبه‌بندی مدارک یک سامانه پشتیبانی هستی. به ازای هر مدرک، امتیاز ارتباط ۰ تا ۱۰ با پرسش کاربر بده. مدارکِ بی‌ارتباط یا کم‌ارتباط را امتیاز پایین بده. فقط JSON بده: [{\"id\": \"...\", \"relevance\": 0}] و هیچ چیز دیگر ننویس.",
          },
          { role: "user", content: `پرسش کاربر: ${question}\n\nمدارک:\n${listing}` },
        ],
        { temperature: 0, maxTokens: 800, timeoutMs: LLM_RERANK_TIMEOUT_MS }
      );
      recordChatUsage(budget, outcome);

      const grades = parseGrades(outcome.content);
      if (grades.length === 0) {
        return this.fallback.rerank(question, candidates, budget);
      }
      const byId = new Map(grades.map((g) => [g.id, g.relevance]));
      const graded = candidates.map((candidate) => {
        const grade = byId.get(candidate.id);
        return grade === undefined
          ? candidate
          : { ...candidate, score: clamp01(0.7 * (grade / 10) + 0.3 * candidate.score) };
      });
      const missingGrade = candidates.filter((c) => !byId.has(c.id)).length;
      if (missingGrade > candidates.length / 2) {
        // The model graded too little of the set — distrust and fall back.
        return this.fallback.rerank(question, candidates, budget);
      }
      graded.sort((a, b) => b.score - a.score);
      return graded;
    } catch (error) {
      if (error instanceof AiDisabledError) throw error;
      return this.fallback.rerank(question, candidates, budget);
    }
  }
}

// ------------------------------------------------------------------ factory --

export async function createReranker(mode: "off" | "heuristic" | "llm"): Promise<Reranker> {
  if (mode === "llm") return new LlmReranker(new HeuristicReranker());
  if (mode === "heuristic") return new HeuristicReranker();
  return {
    id: "off",
    async rerank(_question, candidates) {
      return candidates;
    },
  };
}
