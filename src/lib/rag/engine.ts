import "server-only";

import { clamp01, type RagAnswerInput, type RagResult } from "@/lib/rag/types";
import { createBudget, budgetExceeded, llmBudgetExhausted } from "@/lib/rag/budget";
import { getRagEngineSettings } from "@/lib/rag/config";
import { buildRagQuery, decomposeQuery } from "@/lib/rag/query/transform";
import { runController } from "@/lib/rag/crag/controller";
import { generateGroundedAnswer } from "@/lib/rag/generate/answer";
import { stripInvalidCitations, validateCitations, screenClaims } from "@/lib/rag/generate/verify";
import { persistTurnResult } from "@/lib/rag/trace";
import { STANDARD_FALLBACK_MESSAGE } from "@/lib/ai/departments";
import { getAiGlobalSettings } from "@/lib/ai/settings";
import { getSetting } from "@/lib/settings";
import { extractIdentifiers } from "@/lib/rag/index/lexical";
import { normalizePersian } from "@/lib/kb/text";

/**
 * RAG Engine — `answer()` facade (Stages 3–5 wired end-to-end).
 *
 * Pipeline per turn:
 *   budget → query construction (normalize + conversation contextualization)
 *   → controller (adaptive strategy + retrieval + rerank + CRAG loop)
 *   → grounded generation (only on sufficient, consistent evidence)
 *   → verification (citations ⊆ evidence; optional unsupported-claim screen)
 *   → structured RagResult + full trace persistence.
 *
 * Outcomes (task §9): ANSWERED / CLARIFY / ABSTAIN / ESCALATE. The engine
 * never fabricates: every non-ANSWERED path returns a mandated Persian text
 * and recommends human escalation when the department allows it. Organization
 * answers come exclusively from authorized internal knowledge — no public web
 * fallback exists anywhere in the engine.
 */

export async function answer(input: RagAnswerInput): Promise<RagResult> {
  const started = Date.now();
  const settings = await getRagEngineSettings();
  const budget = createBudget(settings.crag.maxLlmCallsPerTurn, settings.crag.deadlineMs);

  const [aiSettings, orgName] = await Promise.all([
    getAiGlobalSettings(),
    getSetting<string>("org.name"),
  ]);

  // ---------------------------------------------------------- 1. query build
  const query = await buildRagQuery(input.question, input.history, budget);
  const hasIdentifiers = extractIdentifiers(query.normalized).length > 0;

  // Decomposition for multi-constraint questions (budget-guarded).
  if (looksMultiConstraint(input.question) && !llmBudgetExhausted(budget)) {
    query.subQueries = await decomposeQuery(query, budget);
  }

  // ---------------------------------------------------------- 2. CRAG loop
  const outcome = await runController({
    query,
    scope: input.scope,
    budget,
    hasIdentifiers,
  });

  const iterations = outcome.rounds.map((round) => ({
    round: round.round,
    strategy: round.strategy,
    queries: round.queries,
    candidates: round.rerankedCount,
    reranked: round.rerankedCount,
    verdict: round.evaluation.verdict,
    sufficiency: round.evaluation.sufficiency,
  }));

  const conflictDetected = outcome.bestEvaluation.conflicts.length > 0;
  const best = outcome.bestEvaluation;
  const strategy = outcome.strategy;
  const correctiveOccurred = outcome.correctiveActions.length > 0;
  const superseded = outcome.supersededExcluded || best.supersededExcluded;

  // ---------------------------------------------------------- 3. shared shells
  const buildShell = (
    status: RagResult["status"],
    overrides: Partial<RagResult> & { evidence?: RagResult["evidence"]; strategyOverride?: RagResult["strategy"] }
  ): RagResult => {
    const effectiveStrategy = overrides.strategyOverride ?? strategy;
    const evidence = overrides.evidence ?? [];
    const result: RagResult = {
      status,
      answerText: overrides.answerText ?? "",
      citations: overrides.citations ?? [],
      confidence: overrides.confidence ?? clamp01(best.sufficiency),
      strategy: effectiveStrategy,
      correctiveOccurred,
      conflictDetected,
      escalationRecommended:
        overrides.escalationRecommended ??
        (status === "ABSTAIN" ? input.escalationOffer : false),
      clarifyQuestion: overrides.clarifyQuestion ?? null,
      trace: {
        strategy: effectiveStrategy,
        iterations,
        correctiveActions: outcome.correctiveActions,
        llmCalls: budget.llmCalls,
        durationMs: Date.now() - started,
        budgetExceeded: outcome.budgetExceeded || budgetExceeded(budget),
        conflictDetected,
        supersededExcluded: superseded,
        embeddingModel: aiSettings.embeddingModel || settings.embeddings.model,
        promptTokens: budget.promptTokens,
        completionTokens: budget.completionTokens,
      },
      evidence,
      recordSources: evidence.map((e) => ({
        kind: e.kind,
        refId: e.id,
        title: e.kind === "QA" ? e.qaQuestion ?? "پرسش‌وپاسخ رسمی" : e.documentTitle,
        score: Number(e.score.toFixed(4)),
      })),
    };
    return result;
  };

  const persistAndReturn = async (result: RagResult): Promise<RagResult> => {
    await persistTurnResult({
      conversationId: input.conversationId,
      departmentId: input.scope.departmentId,
      query: input.question,
      result,
    });
    return result;
  };

  const abstain = () =>
    persistAndReturn(
      buildShell("ABSTAIN", {
        answerText: STANDARD_FALLBACK_MESSAGE,
        evidence: outcome.evidence, // internal trace/eval only — not shown
      })
    );

  // ---------------------------------------------------------- 4. decision gates
  // Unresolvable conflicts → never answer from contradictory evidence.
  if (conflictDetected && best.verdict !== "RELEVANT") {
    return abstain();
  }

  // FAST_QA short-circuit: an authoritative published Q&A with a strong
  // lexical match IS the official answer — no generation, no judge, no
  // provider dependency. Deterministic, zero-cost, throttle-proof. Conflicts
  // and verdict gates below still apply first.
  const topEvidence = outcome.evidence[0];
  if (
    topEvidence &&
    topEvidence.kind === "QA" &&
    topEvidence.lexicalScore >= 0.7 &&
    best.verdict !== "INSUFFICIENT"
  ) {
    const citations = [
      {
        evidenceId: topEvidence.id,
        title: "پرسش‌وپاسخ رسمی سازمان",
        page: null,
        section: null,
      },
    ];
    return persistAndReturn(
      buildShell("ANSWERED", {
        answerText:
          topEvidence.text +
          (settings.generation.appendCitations ? "\n\nمنابع:\n— پرسش‌وپاسخ رسمی سازمان" : ""),
        citations,
        evidence: [topEvidence],
        confidence: clamp01(Math.max(best.sufficiency, topEvidence.lexicalScore)),
        escalationRecommended: false,
        strategyOverride: "FAST_QA",
      })
    );
  }

  // The department's confidence floor raises (never lowers) the CRAG gate.
  const promotionFloor = Math.max(settings.crag.partialPromotion, input.minConfidence);
  const promotePartial =
    best.verdict === "RELEVANT" ||
    (best.verdict === "PARTIAL" && best.sufficiency >= promotionFloor);

  if (!promotePartial || outcome.evidence.length === 0) {
    const canClarify =
      settings.crag.clarifyOnPartial &&
      best.verdict === "PARTIAL" &&
      best.uncoveredAspects.length > 0 &&
      !outcome.budgetExceeded;

    if (canClarify) {
      const clarifyQuestion = buildClarifyQuestion(best.uncoveredAspects);
      return persistAndReturn(
        buildShell("CLARIFY", {
          answerText: clarifyText(clarifyQuestion),
          clarifyQuestion,
          escalationRecommended: false,
          evidence: outcome.evidence, // internal trace/eval only — not shown
        })
      );
    }
    return abstain();
  }

  // ---------------------------------------------------------- 5. grounded generation
  const evidence = outcome.evidence;
  const history = input.history
    .slice(-6)
    .map((m) => ({
      role: m.role === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
      content: m.content.slice(0, 800),
    }));

  const regenerateStrict = () =>
    generateGroundedAnswer({
      question: input.question,
      evidence,
      orgName,
      departmentName: input.departmentName,
      conflicts: best.conflicts,
      history,
      fallbackMessage: STANDARD_FALLBACK_MESSAGE,
      strictCitations: true,
      budget,
    });

  const onModelRefusalOrFailure = () => abstain();

  let generated = await generateGroundedAnswer({
    question: input.question,
    evidence,
    orgName,
    departmentName: input.departmentName,
    conflicts: best.conflicts,
    history,
    fallbackMessage: STANDARD_FALLBACK_MESSAGE,
    strictCitations: settings.generation.verifyCitations,
  });

  if (!generated || generated.abstained) {
    return onModelRefusalOrFailure();
  }

  // ---------------------------------------------------------- 6. verification
  if (settings.generation.verifyCitations) {
    if (!validateCitations(generated.answer, evidence.length).ok) {
      // One strict re-generation attempt; citations are mandatory there.
      generated = await regenerateStrict();
      if (!generated || generated.abstained) {
        return onModelRefusalOrFailure();
      }
      if (!validateCitations(generated.answer, evidence.length).ok) {
        // Structured insufficient-evidence result (task §7).
        return abstain();
      }
    }
    generated.answer = stripInvalidCitations(generated.answer, evidence.length);
  }

  if (settings.generation.verifyClaims && !llmBudgetExhausted(budget)) {
    const screening = await screenClaims(generated.answer, evidence, budget);
    if (screening && screening.unsupported.length > 0) {
      const retry = await generateGroundedAnswer({
        question:
          input.question +
          `\n\n(گزاره‌های بدون پشتوانه که باید حذف یا با مدارک اصلاح شوند: ${screening.unsupported
            .join(" | ")
            .slice(0, 300)})`,
        evidence,
        orgName,
        departmentName: input.departmentName,
        conflicts: best.conflicts,
        history,
        fallbackMessage: STANDARD_FALLBACK_MESSAGE,
        strictCitations: true,
      });
      const retryOk =
        retry && !retry.abstained && validateCitations(retry.answer, evidence.length).ok;
      if (!retryOk) return abstain();
      retry!.answer = stripInvalidCitations(retry!.answer, evidence.length);
      generated = retry!;
    }
  }

  // ---------------------------------------------------------- 7. citations + result
  const usedMarkers = generated.usedMarkers;
  const citedEvidence = usedMarkers
    .map((marker) => evidence[marker - 1])
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const cited = citedEvidence.length > 0 ? citedEvidence : evidence.slice(0, 1);
  const citations = cited.map((e) => ({
    evidenceId: e.id,
    title: e.kind === "QA" ? "پرسش‌وپاسخ رسمی سازمان" : e.documentTitle,
    page: e.page,
    section: e.headingPath,
  }));

  const answerText =
    generated.answer +
    (settings.generation.appendCitations ? appendCitationBlock(citations) : "");

  return persistAndReturn(
    buildShell("ANSWERED", {
      answerText,
      citations,
      evidence: cited,
      confidence: clamp01(
        0.5 * best.sufficiency + 0.5 * (cited[0]?.score ?? best.sufficiency)
      ),
      escalationRecommended: false,
    })
  );
}

// ------------------------------------------------------------------ helpers --

/** Same heuristic as transform.looksMultiConstraint (import-cycle-free copy). */
function looksMultiConstraint(question: string): boolean {
  const normalized = normalizePersian(question);
  const conjunctions = (normalized.match(/\bو\b|،/g) ?? []).length;
  const conditions = (normalized.match(/شرایط|مدارک|مراحل|چگونه|فهرست|لیست/g) ?? []).length;
  return conjunctions >= 3 || conditions >= 2 || normalized.split(" ").length >= 16;
}

function buildClarifyQuestion(uncoveredAspects: string[]): string {
  const aspects = uncoveredAspects.slice(0, 2).join(" و ");
  return `برای پاسخ دقیق‌تر لطفاً مشخص کنید: ${aspects || "دقیقاً چه اطلاعاتی مد نظر شماست؟"}`;
}

function clarifyText(question: string): string {
  return `${question}\n\nپاسخ دقیق شما نیازمند این توضیح است؛ در صورت تمایل می‌توانید درخواست خود را به اپراتور ارجاع دهید.`;
}

/** Customer-safe citation footer (no internal ids, collections, or paths). */
function appendCitationBlock(
  citations: Array<{ title: string; page: number | null; section: string | null }>
): string {
  if (citations.length === 0) return "";
  const lines = citations.slice(0, 4).map((citation) => {
    const location = [
      citation.section ? `بخش «${citation.section}»` : null,
      citation.page ? `صفحه ${citation.page}` : null,
    ]
      .filter(Boolean)
      .join("، ");
    return `— ${citation.title}${location ? ` (${location})` : ""}`;
  });
  return `\n\nمنابع:\n${lines.join("\n")}`;
}
