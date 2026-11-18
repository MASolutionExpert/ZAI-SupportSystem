import "server-only";

import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * RAG engine configuration — stored in SystemSetting (`rag.engine`), validated
 * with zod, admin-editable without redeploy (task §11). Cached in-process for
 * a short TTL; every retrieval turn reads one consistent snapshot.
 *
 * Defaults live in a literal object (deep-merged with the stored patch BEFORE
 * parsing) so future engine versions can add knobs without data migrations.
 */

export const RAG_SETTING_KEY = "rag.engine";

// ----------------------------------------------------------------- schema --

const embeddingsSchema = z.object({
  /** "builtin-hashed" needs no network; "openai-compatible" uses the chat provider's credentials. */
  provider: z.enum(["builtin-hashed", "openai-compatible"]),
  /** Model id — for builtin-hashed it is fixed by implementation version. */
  model: z.string().min(1).max(100),
  /** Expected vector dimension — written per chunk; mismatch ⇒ vector path skips. */
  dim: z.number().int().min(64).max(4096).optional(),
});

const retrievalSchema = z.object({
  /** Candidate count per retriever before fusion. */
  candidateK: z.number().int().min(5).max(80),
  /** Final evidence count after fusion + rerank. */
  finalTopK: z.number().int().min(1).max(12),
  /** RRF constant k (standard 60). */
  rrfK: z.number().int().min(10).max(120),
  /** Lexical threshold below which a candidate is dropped pre-fusion. */
  lexicalFloor: z.number().min(0).max(1),
  /** Cosine floor below which a vector candidate is dropped pre-fusion. */
  semanticFloor: z.number().min(0).max(1),
  /** Parent-child expansion: fetch parent section for top children. */
  parentExpansion: z.boolean(),
  /** Max parent expansions per retrieval round. */
  parentExpansionLimit: z.number().int().min(0).max(6),
  /** Hard cap on total evidence text chars sent to a model. */
  maxContextChars: z.number().int().min(2000).max(60000),
});

const rerankSchema = z.object({
  /** Reranking layer; heuristic is deterministic and free. */
  mode: z.enum(["off", "heuristic", "llm"]),
  /** Candidates kept for the rerank stage. */
  rerankCandidates: z.number().int().min(5).max(50),
  /** LLM reranker call timeout guard. */
  llmTimeoutMs: z.number().int().min(2000).max(30000),
});

const cragSchema = z.object({
  /** CRAG controller on/off (kill switch for latency-sensitive deployments). */
  enabled: z.boolean(),
  /** Bounded corrective rounds (task: strict limits, no infinite loops). */
  maxCorrectiveRounds: z.number().int().min(0).max(3),
  /** Hard cap of model calls per engine turn (across all stages). */
  maxLlmCallsPerTurn: z.number().int().min(2).max(20),
  /** Wall-clock budget per engine turn. */
  deadlineMs: z.number().int().min(5000).max(120000),
  /** Confidence above which PARTIAL verdicts are promoted to RELEVANT. */
  partialPromotion: z.number().min(0).max(1),
  /** Confidence floor below which the loop stops even mid-budget. */
  insufficiencyFloor: z.number().min(0).max(1),
  /** Ask a clarifying question when PARTIAL and uncoveredAspects exist. */
  clarifyOnPartial: z.boolean(),
});

const generationSchema = z.object({
  /** Verify citations ⊆ evidence before showing the answer. */
  verifyCitations: z.boolean(),
  /** LLM unsupported-claim screening pass. */
  verifyClaims: z.boolean(),
  /** Include customer-safe citations appended under the answer. */
  appendCitations: z.boolean(),
});

const ragEngineSettingsSchema = z.object({
  embeddings: embeddingsSchema,
  retrieval: retrievalSchema,
  rerank: rerankSchema,
  crag: cragSchema,
  generation: generationSchema,
});

export type RagEngineSettings = z.infer<typeof ragEngineSettingsSchema>;

/** Literal defaults — the single source of truth for engine knobs. */
export const RAG_DEFAULTS: RagEngineSettings = {
  embeddings: { provider: "builtin-hashed", model: "hashed-fa-v1" },
  retrieval: {
    candidateK: 24,
    finalTopK: 5,
    rrfK: 60,
    lexicalFloor: 0.12,
    semanticFloor: 0.55,
    parentExpansion: true,
    parentExpansionLimit: 3,
    maxContextChars: 12000,
  },
  rerank: { mode: "heuristic", rerankCandidates: 16, llmTimeoutMs: 8000 },
  crag: {
    enabled: true,
    maxCorrectiveRounds: 2,
    maxLlmCallsPerTurn: 6,
    deadlineMs: 25000,
    partialPromotion: 0.75,
    insufficiencyFloor: 0.08,
    clarifyOnPartial: true,
  },
  generation: { verifyCitations: true, verifyClaims: true, appendCitations: true },
};

// ----------------------------------------------------------------- loading --

function deepMergeDefaults(defaults: RagEngineSettings, patch: unknown): RagEngineSettings {
  if (patch === null || patch === undefined || typeof patch !== "object" || Array.isArray(patch)) {
    return defaults;
  }
  const out: Record<string, unknown> = { ...(defaults as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    if (
      current && typeof current === "object" && !Array.isArray(current) &&
      value && typeof value === "object" && !Array.isArray(value)
    ) {
      out[key] = deepMergeDefaults(current as RagEngineSettings, value);
    } else if (value !== undefined && current !== undefined) {
      out[key] = value;
    }
  }
  return out as unknown as RagEngineSettings;
}

let cache: { value: RagEngineSettings; at: number } | null = null;
const CACHE_TTL_MS = 10_000;

export function invalidateRagConfigCache(): void {
  cache = null;
}

/** Load the effective engine settings (defaults deep-merged with stored patch). */
export async function getRagEngineSettings(): Promise<RagEngineSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const raw = await getSetting<unknown>(RAG_SETTING_KEY);
  const merged = ragEngineSettingsSchema.parse(deepMergeDefaults(RAG_DEFAULTS, raw));
  cache = { value: merged, at: Date.now() };
  return merged;
}

/**
 * Persist a validated partial update. Unknown/invalid fields are rejected by
 * zod — the admin panel cannot store garbage that retrieval would choke on.
 */
export async function updateRagEngineSettings(
  patch: unknown,
  updatedBy: string
): Promise<RagEngineSettings> {
  const current = await getRagEngineSettings();
  const merged = ragEngineSettingsSchema.parse(deepMergeDefaults(current, patch));
  // Store only the patch — defaults stay implicit so future engine versions
  // can introduce new knobs without a migration of stored JSON.
  await setSetting(RAG_SETTING_KEY, patch ?? {}, updatedBy);
  invalidateRagConfigCache();
  return merged;
}
