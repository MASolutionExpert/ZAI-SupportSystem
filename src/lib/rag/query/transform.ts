import "server-only";

import { normalizePersian, tokenize } from "@/lib/kb/text";
import { getActiveAdapter, AiDisabledError } from "@/lib/ai/adapter";
import { resolveChatModel, getAiGlobalSettings } from "@/lib/ai/settings";
import type { ChatMessage } from "@/lib/ai/types";
import type { TranscriptMessage } from "@/lib/conversations/types";
import type { Budget } from "@/lib/rag/budget";
import { budgetExceeded, recordChatUsage } from "@/lib/rag/budget";
import type { RagQuery } from "@/lib/rag/types";

/**
 * RAG Engine — query transformation (task §4.D).
 *
 * All transformations are budget-guarded, JSON-parsed, and failure-tolerant:
 * a failed / refused / malformed LLM response degrades to a no-op (the
 * original query is always preserved and remains the retrieval anchor — the
 * trace records the original question verbatim).
 */

const MAX_REWRITES = 1;
const MAX_EXPANSIONS = 3;
const MAX_SUBQUERIES = 4;
const TRANSFORM_TIMEOUT_MS = 9000;
const MAX_HISTORY_CHARS = 1600;

/** JSON-extraction tolerant of markdown fences / prose wrappers. */
function extractJsonBlock(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  const opening = candidate[start];
  const closing = opening === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closing);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && item.length <= 300)
    .slice(0, max);
}

async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  budget: Budget
): Promise<unknown | null> {
  if (budgetExceeded(budget)) return null;
  try {
    const { adapter } = await getActiveAdapter();
    const settings = await getAiGlobalSettings();
    const model = await resolveChatModel(settings);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    const outcome = await adapter.chat(model, messages, {
      temperature: 0,
      maxTokens: 500,
      timeoutMs: TRANSFORM_TIMEOUT_MS,
    });
    recordChatUsage(budget, outcome);
    return extractJsonBlock(outcome.content);
  } catch (error) {
    if (error instanceof AiDisabledError) throw error; // kill switch must propagate
    return null; // any transform failure degrades to no-op
  }
}

// ---------------------------------------------------------------- heuristics --

/** Query looks referential (needs conversation context to be meaningful). */
function looksReferential(question: string, history: TranscriptMessage[]): boolean {
  if (history.length === 0) return false;
  const normalized = normalizePersian(question);
  if (/^(این|همان|اون|دومی|اولی|بالا|قبلی|بعدی)\b/.test(normalized)) return true;
  if (/(همان|قبلی|بالا|فوق|اون مورد|آن مورد)/.test(normalized)) return true;
  return tokenize(normalized).length <= 2;
}

/** Multi-constraint question (several conjunctions / requirements). */
export function looksMultiConstraint(question: string): boolean {
  const normalized = normalizePersian(question);
  const conjunctions = (normalized.match(/\bو\b|،|;|;/g) ?? []).length;
  const conditions = (normalized.match(/(شرایط|مدارک|مراحل|چگونه|همه|فهرست|لیست)/g) ?? []).length;
  return conjunctions >= 3 || conditions >= 2 || tokenize(normalized).length >= 14;
}

// ------------------------------------------------------------- transformations --

/** Build the engine query object: normalization + conversation contextualization. */
export async function buildRagQuery(
  original: string,
  history: TranscriptMessage[],
  budget: Budget
): Promise<RagQuery> {
  const normalized = normalizePersian(original);
  const query: RagQuery = {
    original,
    normalized,
    rewrites: [],
    expansions: [],
    subQueries: [],
  };

  if (looksReferential(original, history) && !budgetExceeded(budget)) {
    const historyText = history
      .slice(-6)
      .map((m) => `${m.role === "CUSTOMER" ? "مشتری" : "دستیار"}: ${m.content}`)
      .join("\n")
      .slice(0, MAX_HISTORY_CHARS);

    const parsed = await callLlm(
      "تو ماژول بازنویسی پرسش یک سامانه پشتیبانی هستی. پرسش جدید مشتری را با توجه به گفتگوی اخیر به یک «پرسش مستقل و کامل» تبدیل کن که بدون خواندن گفتگو هم قابل فهم باشد. فقط JSON بده: {\"standalone\": \"...\"}. اگر پرسش از قبل مستقل است، همان را برگردان. هیچ پاسخی به پرسش نده.",
      `گفتگوی اخیر:\n${historyText}\n\nپرسش جدید مشتری: ${original}`,
      budget
    );
    if (parsed && typeof parsed === "object" && "standalone" in parsed) {
      const standalone = (parsed as { standalone?: unknown }).standalone;
      if (typeof standalone === "string" && standalone.trim().length >= 3) {
        query.rewrites.push(standalone.trim().slice(0, 300));
      }
    }
  }

  return query;
}

/** Generate alternative phrasings (multi-query expansion). */
export async function expandQuery(
  query: RagQuery,
  budget: Budget
): Promise<string[]> {
  const base = query.rewrites[0] ?? query.original;
  const parsed = await callLlm(
    "تو ماژول گسترش پرسش یک سامانه پشتیبانی فارسی هستی. برای پرسش داده‌شده حداکثر ۳ بازنویسی جایگزین با واژگان متفاوت (مترادف‌ها و صورت‌های دیگر همان پرسش) بساز. فقط JSON بده: {\"variants\": [\"...\"]}. هیچ پاسخی به پرسش نده.",
    `پرسش: ${base}`,
    budget
  );
  if (!parsed) return [];
  const variants = toStringArray((parsed as { variants?: unknown }).variants, MAX_EXPANSIONS);
  return variants.filter((v) => normalizePersian(v) !== query.normalized);
}

/** Decompose a multi-constraint question into sub-questions. */
export async function decomposeQuery(
  query: RagQuery,
  budget: Budget
): Promise<string[]> {
  const base = query.rewrites[0] ?? query.original;
  const parsed = await callLlm(
    "تو ماژول تجزیه پرسش یک سامانه پشتیبانی فارسی هستی. اگر پرسش چند الزام یا بخش مستقل دارد، آن را به حداکثر ۴ زیرپرسش ساده و مستقل بشکن که هر یک بتواند جداگانه از مخزن دانش بازیابی شود. اگر پرسش ساده است، فقط JSON {\"subqueries\": []} بده. فقط JSON بده، هیچ پاسخی نده.",
    `پرسش: ${base}`,
    budget
  );
  if (!parsed) return [];
  return toStringArray((parsed as { subqueries?: unknown }).subqueries, MAX_SUBQUERIES);
}

/**
 * Rewrite the query (corrective action REWRITE_QUERY): leaner, search-oriented
 * form of the question.
 */
export async function rewriteQuery(
  query: RagQuery,
  hint: string,
  budget: Budget
): Promise<string | null> {
  const base = query.rewrites[0] ?? query.original;
  const parsed = await callLlm(
    "تو ماژول بازنویسی پرسش برای جستجوی مخزن دانش یک سامانه پشتیبانی فارسی هستی. پرسش را به یک عبارت جستجوی کوتاه‌تر و کلیدواژه‌محور (بدون کلمات پرتکرار) تبدیل کن و نکته اصلاحی داده‌شده را لحاظ کن. فقط JSON بده: {\"query\": \"...\"}. هیچ پاسخی به پرسش نده.",
    `پرسش: ${base}\nنکته اصلاحی: ${hint}`,
    budget
  );
  if (!parsed) return null;
  const rewritten = (parsed as { query?: unknown }).query;
  if (typeof rewritten === "string" && rewritten.trim().length >= 3) {
    return rewritten.trim().slice(0, 300);
  }
  return null;
}

/** All effective search strings for a query (original preserved first). */
export function effectiveQueries(query: RagQuery): string[] {
  const queries = [query.original];
  if (query.rewrites[0]) queries.push(query.rewrites[0]);
  return queries;
}
