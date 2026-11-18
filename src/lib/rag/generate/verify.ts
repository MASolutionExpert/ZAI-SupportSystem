import "server-only";

import { getActiveAdapter, AiDisabledError } from "@/lib/ai/adapter";
import { resolveChatModel, getAiGlobalSettings } from "@/lib/ai/settings";
import type { Evidence } from "@/lib/rag/types";
import type { Budget } from "@/lib/rag/budget";
import { budgetExceeded, recordChatUsage } from "@/lib/rag/budget";

/**
 * RAG Engine — answer verification (task §7).
 *
 * Two deterministic-first checks before an answer is shown:
 *  1. Citation validation — every [n] marker must resolve to a real evidence
 *     index; an answer with zero resolvable citations fails (the controller
 *     gets one strict re-generation attempt, then abstains).
 *  2. Unsupported-claim screening — an LLM pass comparing the answer's factual
 *     sentences against the evidence; unsupported claims send the answer back
 *     for one grounded regeneration, and a repeat failure abstains.
 *
 * Deterministic helpers also strip forged citations like [99] so a hallucinated
 * marker can never render as a valid reference in the UI.
 */

export type CitationCheck = {
  ok: boolean;
  usedMarkers: number[];
  invalidMarkers: number[];
};

/** Deterministic citation validation against the evidence list length. */
export function validateCitations(answer: string, evidenceCount: number): CitationCheck {
  const usedMarkers: number[] = [];
  const invalidMarkers: number[] = [];
  for (const match of answer.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= evidenceCount) {
      if (!usedMarkers.includes(n)) usedMarkers.push(n);
    } else {
      if (!invalidMarkers.includes(n)) invalidMarkers.push(n);
    }
  }
  // De-ionize: at least one valid citation and no invalid ones.
  return {
    ok: usedMarkers.length > 0 && invalidMarkers.length === 0,
    usedMarkers: usedMarkers.sort((a, b) => a - b),
    invalidMarkers,
  };
}

/** Remove markers that do not resolve (defense against forged citations). */
export function stripInvalidCitations(answer: string, evidenceCount: number): string {
  return answer.replace(/\[(\d{1,3})\]/g, (marker, digits: string) => {
    const n = Number(digits);
    return n >= 1 && n <= evidenceCount ? marker : "";
  });
}

const VERIFY_TIMEOUT_MS = 8000;

type ClaimVerdict = {
  supported: unknown;
  unsupported_claims?: unknown;
};

function parseClaimVerdict(text: string): { unsupported: string[] } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as ClaimVerdict;
    if (parsed.supported === true) return { unsupported: [] };
    if (Array.isArray(parsed.unsupported_claims)) {
      return {
        unsupported: parsed.unsupported_claims
          .filter((c): c is string => typeof c === "string")
          .slice(0, 5),
      };
    }
    return { unsupported: [] };
  } catch {
    return null;
  }
}

/**
 * LLM unsupported-claim screening. Returns null when skipped (budget/off)
 * — the caller treats null as "verification unavailable" and relies on the
 * deterministic citation check + grounding prompt.
 */
export async function screenClaims(
  answer: string,
  evidence: Evidence[],
  budget: Budget
): Promise<{ unsupported: string[] } | null> {
  if (budgetExceeded(budget)) return null;

  const listing = evidence
    .slice(0, 8)
    .map((e, index) => `[${index + 1}] ${e.text.slice(0, 500).replace(/\s+/g, " ")}`)
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
            "تو راستی‌آزما پاسخ‌ها هستی. پاسخ را فقط با مدارک داده‌شده بسنج: اگر هر گزاره واقعی پاسخ توسط مدارک پشتیبانی نمی‌شود، فهرست آن گزاره‌ها را بده. فقط JSON بده: {\"supported\": true} یا {\"supported\": false, \"unsupported_claims\": [\"...\"]}. هیچ چیز دیگر ننویس.",
        },
        {
          role: "user",
          content: `مدارک:\n${listing}\n\nپاسخ:\n${answer.slice(0, 1500)}`,
        },
      ],
      { temperature: 0, maxTokens: 400, timeoutMs: VERIFY_TIMEOUT_MS }
    );
    recordChatUsage(budget, outcome);
    return parseClaimVerdict(outcome.content);
  } catch (error) {
    if (error instanceof AiDisabledError) throw error;
    return null;
  }
}
