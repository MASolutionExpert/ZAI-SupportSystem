/**
 * AI integration — shared types (Phase 3, AI-ARCHITECTURE).
 *
 * Provider abstraction: "builtin" (z-ai-web-dev-sdk, no key required) and
 * "openai-compatible" (any OpenAI-style endpoint via Base URL + API key).
 */

export const AI_PROVIDER_TYPES = ["builtin", "openai-compatible"] as const;
export type AiProviderType = typeof AI_PROVIDER_TYPES[number];
export const AI_PROVIDER_TYPE_LABELS: Record<AiProviderType, string> = {
  builtin: "سرویس داخلی (بدون نیاز به کلید)",
  "openai-compatible": "سازگار با OpenAI (Base URL + کلید)",
};

export type AiGlobalSettings = {
  enabled: boolean; // master kill switch
  providerType: AiProviderType;
  chatModel: string; // builtin default "zai-builtin"
  embeddingModel: string; // "" = semantic search off (keyword-only retrieval)
  baseUrl: string; // openai-compatible only, e.g. https://api.example.com/v1
  apiKeyEncrypted: string | null; // enc.v1 envelope — NEVER returned to client
  temperature: number; // 0..2
  maxTokens: number; // 50..4000
  timeoutMs: number; // 5000..120000
  updatedAt?: string;
};

export type AiGlobalSettingsPublic = Omit<
  AiGlobalSettings,
  "apiKeyEncrypted" | "updatedAt"
> & {
  apiKeySet: boolean;
  apiKeyMasked: string | null;
  updatedAt: string | null;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatParams = { temperature?: number; maxTokens?: number; timeoutMs?: number };
export type ChatOutcome = { content: string; promptTokens: number; completionTokens: number; model: string };

export type AiTestResult = {
  ok: boolean;
  provider: AiProviderType;
  detail: string;
  models: string[];
  latencyMs: number;
};

export type DepartmentAiSettings = {
  minConfidence: number; // 0..1, default 0.35
  escalationOffer: boolean; // default true — abstention offers «ارتباط با اپراتور»
  fallbackMessage: string | null; // null → standard fallback message
  dailyMessageLimit: number | null; // null = unlimited; overage → abstain + escalation
};
