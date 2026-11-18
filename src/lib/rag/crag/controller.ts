import "server-only";

import { clamp01, type AccessScope, type CorrectiveAction, type Evidence, type EvidenceEvaluation, type RagQuery, type RagStrategy } from "@/lib/rag/types";
import type { Budget } from "@/lib/rag/budget";
import { budgetExceeded, outOfTime } from "@/lib/rag/budget";
import { getRagEngineSettings } from "@/lib/rag/config";
import { executeRetrievalRound } from "@/lib/rag/index/retrieval";
import { createReranker } from "@/lib/rag/rerank";
import { evaluateEvidence } from "./evaluator";
import { looksMultiConstraint } from "@/lib/rag/query/transform";

/**
 * RAG Engine — Corrective RAG controller (task §6).
 *
 * Owns the adaptive strategy choice and the bounded corrective loop:
 *   round 0: strategy selected from query characteristics
 *            (exact identifiers → LEXICAL; multi-constraint → DECOMPOSE /
 *             MULTI_QUERY; default → HYBRID; cheap authoritative-Q&A probe →
 *             FAST_QA shortcut decided by the controller between rounds)
 *   evaluation: RELEVANT → generation; PARTIAL → corrective actions in
 *            increasing cost order (rewrite → multi-query → parent expansion →
 *            decomposition); INSUFFICIENT → strategy escalation.
 *   termination: budgets (rounds / LLM calls / wall-clock) are hard limits —
 *            the controller records every corrective action and its result.
 *
 * Validity handling: evidence from documents past their `validUntil` is
 * excluded before evaluation and reported as supersededExcluded.
 */

export type ControllerRound = {
  round: number;
  strategy: RagStrategy;
  queries: string[];
  evidence: Evidence[];
  evaluation: EvidenceEvaluation;
  rerankedCount: number;
};

export type ControllerOutcome = {
  rounds: ControllerRound[];
  evidence: Evidence[]; // final reranked evidence of the best round
  bestEvaluation: EvidenceEvaluation;
  strategy: RagStrategy;
  correctiveActions: CorrectiveAction[];
  budgetExceeded: boolean;
  supersededExcluded: boolean;
  incompatibleSkipped: number;
};

/** Confidence promotion threshold for PARTIAL verdicts (config). */
function promotionThreshold(partialPromotion: number): number {
  return partialPromotion;
}

/** Strategy escalation ladder for INSUFFICIENT rounds. */
const ESCALATION: Record<RagStrategy, RagStrategy> = {
  FAST_QA: "HYBRID",
  LEXICAL: "HYBRID",
  SEMANTIC: "HYBRID",
  HYBRID: "MULTI_QUERY",
  MULTI_QUERY: "DECOMPOSE",
  DECOMPOSE: "DECOMPOSE",
};

export function selectInitialStrategy(query: RagQuery, hasIdentifiers: boolean): RagStrategy {
  if (looksMultiConstraint(query.original)) return "MULTI_QUERY";
  if (hasIdentifiers) return "LEXICAL";
  return "HYBRID";
}

export async function runController(input: {
  query: RagQuery;
  scope: AccessScope;
  budget: Budget;
  hasIdentifiers: boolean;
}): Promise<ControllerOutcome> {
  const settings = await getRagEngineSettings();
  const reranker = await createReranker(settings.rerank.mode);

  let strategy = selectInitialStrategy(input.query, input.hasIdentifiers);
  if (settings.crag.enabled && looksMultiConstraint(input.query.original) && input.query.subQueries.length === 0) {
    // Multi-constraint but decomposition unavailable (no LLM budget) — union
    // retrieval with expansions still helps; DECOMPOSE degrades to MULTI_QUERY.
    strategy = "MULTI_QUERY";
  }

  const rounds: ControllerRound[] = [];
  const correctiveActions: CorrectiveAction[] = [];
  let budgetExceededFlag = false;
  let supersededExcluded = false;
  let incompatibleSkipped = 0;
  let bestSufficiency = -1;
  let bestEvidence: Evidence[] = [];
  let bestEvaluation: EvidenceEvaluation | null = null;
  let bestStrategy = strategy;

  const maxRounds = settings.crag.enabled ? settings.crag.maxCorrectiveRounds + 1 : 1;

  for (let round = 0; round < maxRounds; round++) {
    if (budgetExceeded(input.budget) || outOfTime(input.budget)) {
      budgetExceededFlag = true;
      correctiveActions.push({
        round,
        action: "BUDGET",
        detail: "بودجه نوبت (زمان/فراخوان مدل) به پایان رسید؛ حلقه اصلاحی متوقف شد.",
        result: "BUDGET",
      });
      break;
    }

    // ---------------------------------------------------- retrieval + rerank
    const retrieval = await executeRetrievalRound(strategy, input.query, input.scope, input.budget);
    incompatibleSkipped = Math.max(incompatibleSkipped, retrieval.incompatibleSkipped);

    let candidates = retrieval.evidence;

    // Validity filter: expired documents out (report in trace).
    const now = Date.now();
    const expired = candidates.filter(
      (e) => e.validUntil && new Date(e.validUntil).getTime() < now
    );
    if (expired.length > 0) {
      supersededExcluded = true;
      candidates = candidates.filter(
        (e) => !e.validUntil || new Date(e.validUntil).getTime() >= now
      );
    }

    const reranked =
      settings.rerank.mode === "off"
        ? candidates
        : await reranker.rerank(
            input.query.rewrites[0] ?? input.query.original,
            candidates.slice(0, settings.rerank.rerankCandidates),
            input.budget
          );

    // ---------------------------------------------------- evaluation
    const evaluation = await evaluateEvidence(
      input.query.rewrites[0] ?? input.query.original,
      reranked.slice(0, settings.retrieval.finalTopK),
      input.budget
    );

    rounds.push({
      round,
      strategy,
      queries: retrieval.queries,
      evidence: reranked.slice(0, settings.retrieval.finalTopK),
      evaluation,
      rerankedCount: reranked.length,
    });

    const improved = evaluation.sufficiency > bestSufficiency + 0.02;
    if (improved) {
      bestSufficiency = evaluation.sufficiency;
      bestEvidence = reranked.slice(0, settings.retrieval.finalTopK);
      bestEvaluation = evaluation;
      bestStrategy = strategy;
    }

    // ---------------------------------------------------- decision
    const promoted =
      evaluation.verdict === "RELEVANT" ||
      (evaluation.verdict === "PARTIAL" &&
        evaluation.sufficiency >= promotionThreshold(settings.crag.partialPromotion));
    if (promoted) break;

    if (round === maxRounds - 1) break; // no further corrective rounds

    // ---------------------------------------------- corrective actions
    // Corrective ladder (cheap → expensive), each budget-guarded:
    //   INSUFFICIENT round 0 → REWRITE_QUERY (new keywords) + escalate strategy
    //   INSUFFICIENT round ≥1 → MULTI_QUERY expansions + escalate strategy
    //   PARTIAL round 0 → REWRITE_QUERY + HYBRID
    //   PARTIAL round ≥1 → MULTI_QUERY + parent-expansion next round
    const { rewriteQuery, expandQuery } = await import("@/lib/rag/query/transform");

    if (evaluation.verdict === "INSUFFICIENT" && round === 0) {
      const rewritten = await rewriteQuery(
        input.query,
        "هیچ مدرکی بازیابی نشد؛ با مترادف‌ها و کلیدواژه‌های متفاوت (مثلاً ثبت‌نام، دوره، کلاس، عضویت) دوباره بساز",
        input.budget
      );
      if (rewritten) {
        input.query.rewrites = [rewritten, ...input.query.rewrites].slice(0, 2);
        correctiveActions.push({
          round,
          action: "REWRITE_QUERY",
          detail: `بازنویسی پرسش پس از بازیابی خالی: «${rewritten.slice(0, 120)}»`,
          result: "IMPROVED",
        });
      }
    } else if (evaluation.verdict === "INSUFFICIENT" && round >= 1) {
      if (input.query.expansions.length === 0 && !budgetExceeded(input.budget)) {
        input.query.expansions = await expandQuery(input.query, input.budget);
        correctiveActions.push({
          round,
          action: "MULTI_QUERY",
          detail: `گسترش پرسش به ${input.query.expansions.length} صورت جایگزین`,
          result: "IMPROVED",
        });
      }
    } else if (evaluation.verdict === "PARTIAL") {
      if (round === 0) {
        const rewritten = await rewriteQuery(
          input.query,
          evaluation.uncoveredAspects.join("؛ ") || "پوشش ناقص مدارک",
          input.budget
        );
        if (rewritten) {
          input.query.rewrites = [rewritten, ...input.query.rewrites].slice(0, 2);
          correctiveActions.push({
            round,
            action: "REWRITE_QUERY",
            detail: `بازنویسی پرسش برای بازیابی بهتر: «${rewritten.slice(0, 120)}»`,
            result: "IMPROVED",
          });
        }
        strategy = "HYBRID";
        correctiveActions.push({
          round,
          action: "HYBRID_RETRIEVE",
          detail: "بازیابی مجدد با استراتژی ترکیبی پس از بازنویسی",
          result: "IMPROVED",
        });
      } else {
        if (input.query.expansions.length === 0 && !budgetExceeded(input.budget)) {
          input.query.expansions = await expandQuery(input.query, input.budget);
          correctiveActions.push({
            round,
            action: "MULTI_QUERY",
            detail: `گسترش پرسش به ${input.query.expansions.length} صورت جایگزین`,
            result: "IMPROVED",
          });
        }
        if (!retrieval.parentExpansions && settings.retrieval.parentExpansion) {
          correctiveActions.push({
            round,
            action: "EXPAND_PARENTS",
            detail: "گسترش والد قطعه‌های برتر برای زمینه بیشتر در دور بعد",
            result: "IMPROVED",
          });
        }
        strategy = "MULTI_QUERY";
      }
    } else {
      // RELEVANT handled above; any other state escalates the strategy ladder.
      const next = ESCALATION[strategy];
      correctiveActions.push({
        round,
        action: "HYBRID_RETRIEVE",
        detail: `ارتقای استراتژی از ${strategy} به ${next}`,
        result: "IMPROVED",
      });
      strategy = next;
    }

    // INSUFFICIENT always escalates the strategy ladder as well.
    if (evaluation.verdict === "INSUFFICIENT") {
      strategy = ESCALATION[strategy];
    }
  }

  // Honest accounting: corrective actions only count as IMPROVED when the
  // final sufficiency actually beat round 0's evaluation.
  const baselineSufficiency = rounds[0]?.evaluation.sufficiency ?? 0;
  const finalImproved = bestSufficiency > baselineSufficiency + 0.02;
  const resolvedActions = correctiveActions.map((action) => ({
    ...action,
    result: finalImproved ? action.result : ("NO_CHANGE" as const),
  }));

  return {
    rounds,
    evidence: bestEvidence,
    bestEvaluation:
      bestEvaluation ??
      ({
        verdict: "INSUFFICIENT",
        sufficiency: 0,
        uncoveredAspects: [],
        conflicts: [],
        supersededExcluded: false,
        rationale: "هیچ مدرک قابل ارزیابی بازیابی نشد.",
      } satisfies EvidenceEvaluation),
    strategy: bestStrategy,
    correctiveActions: resolvedActions,
    budgetExceeded: budgetExceededFlag,
    supersededExcluded,
    incompatibleSkipped,
  };
}
