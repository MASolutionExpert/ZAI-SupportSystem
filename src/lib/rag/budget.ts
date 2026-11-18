import "server-only";

import type { ChatOutcome } from "@/lib/ai/types";

/**
 * RAG Engine — per-turn budgets (task §6: strict limits, no infinite loops).
 * One Budget instance lives for a single engine turn and is shared by every
 * stage; every model call, token and the wall-clock deadline are tracked
 * centrally so the conversation pipeline can persist real usage numbers.
 */

export type Budget = {
  llmCalls: number;
  maxLlmCalls: number;
  deadlineAt: number;
  deadlineMs: number;
  promptTokens: number;
  completionTokens: number;
};

export function createBudget(maxLlmCalls: number, deadlineMs: number): Budget {
  return {
    llmCalls: 0,
    maxLlmCalls,
    deadlineAt: Date.now() + deadlineMs,
    deadlineMs,
    promptTokens: 0,
    completionTokens: 0,
  };
}

/** Record one completed chat call (tokens + count) onto the turn budget. */
export function recordChatUsage(budget: Budget, outcome: ChatOutcome): void {
  budget.llmCalls += 1;
  budget.promptTokens += outcome.promptTokens;
  budget.completionTokens += outcome.completionTokens;
}

export function budgetExceeded(budget: Budget): boolean {
  return budget.llmCalls >= budget.maxLlmCalls || Date.now() >= budget.deadlineAt;
}

export function llmBudgetExhausted(budget: Budget): boolean {
  return budget.llmCalls >= budget.maxLlmCalls;
}

export function outOfTime(budget: Budget): boolean {
  return Date.now() >= budget.deadlineAt;
}
