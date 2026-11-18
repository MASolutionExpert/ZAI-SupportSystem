import "server-only";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { AI_PROVIDER_TYPES } from "./types";
import type {
  AiGlobalSettings,
  AiGlobalSettingsPublic,
  AiProviderType,
} from "./types";

/**
 * Global AI settings — persisted as a JSON document under the SystemSetting
 * key "ai.global". The API key is stored only in encrypted (enc.v1) form and
 * is never exposed through the public view.
 */

export const AI_GLOBAL_KEY = "ai.global";

export const DEFAULT_AI_GLOBAL_SETTINGS: AiGlobalSettings = {
  enabled: true,
  providerType: "builtin",
  chatModel: "zai-builtin",
  embeddingModel: "",
  baseUrl: "",
  apiKeyEncrypted: null,
  temperature: 0.2,
  maxTokens: 700,
  timeoutMs: 30000,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// ------------------------------------------------------- defensive parsing --

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asClampedInt(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(clamp(value, min, max));
}

function asClampedNumber(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clamp(value, min, max);
}

function asProviderType(value: unknown): AiProviderType | undefined {
  return typeof value === "string" && (AI_PROVIDER_TYPES as readonly string[]).includes(value)
    ? (value as AiProviderType)
    : undefined;
}

/** Merge stored JSON over defaults; wrong-typed fields fall back to defaults. */
function parseStoredSettings(stored: unknown): AiGlobalSettings {
  if (stored === null || stored === undefined || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...DEFAULT_AI_GLOBAL_SETTINGS };
  }
  const raw = stored as Record<string, unknown>;
  const defaults = DEFAULT_AI_GLOBAL_SETTINGS;
  const apiKeyEncryptedRaw = asString(raw.apiKeyEncrypted);

  return {
    enabled: asBoolean(raw.enabled) ?? defaults.enabled,
    providerType: asProviderType(raw.providerType) ?? defaults.providerType,
    chatModel: asString(raw.chatModel) ?? defaults.chatModel,
    embeddingModel: asString(raw.embeddingModel) ?? defaults.embeddingModel,
    baseUrl: asString(raw.baseUrl) ?? defaults.baseUrl,
    // Ignore wrong-typed values; an empty string counts as "not set".
    apiKeyEncrypted:
      apiKeyEncryptedRaw && apiKeyEncryptedRaw.trim().length > 0
        ? apiKeyEncryptedRaw
        : null,
    temperature: asClampedNumber(raw.temperature, 0, 2) ?? defaults.temperature,
    maxTokens: asClampedInt(raw.maxTokens, 50, 4000) ?? defaults.maxTokens,
    timeoutMs: asClampedInt(raw.timeoutMs, 5000, 120000) ?? defaults.timeoutMs,
  };
}

// ----------------------------------------------------------------- queries --

export async function getAiGlobalSettings(): Promise<AiGlobalSettings> {
  const stored = await getSetting<unknown>(AI_GLOBAL_KEY);
  return parseStoredSettings(stored);
}

export async function getAiGlobalSettingsPublic(): Promise<AiGlobalSettingsPublic> {
  const settings = await getAiGlobalSettings();
  const plaintext = decryptSecret(settings.apiKeyEncrypted);
  const row = await db.systemSetting.findUnique({
    where: { key: AI_GLOBAL_KEY },
    select: { updatedAt: true },
  });

  return {
    enabled: settings.enabled,
    providerType: settings.providerType,
    chatModel: settings.chatModel,
    embeddingModel: settings.embeddingModel,
    baseUrl: settings.baseUrl,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutMs: settings.timeoutMs,
    apiKeySet: !!settings.apiKeyEncrypted,
    apiKeyMasked: plaintext ? maskSecret(plaintext) : null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------- mutations --

export type AiGlobalSettingsPatch = Partial<{
  enabled: boolean;
  providerType: AiProviderType;
  chatModel: string;
  embeddingModel: string;
  baseUrl: string;
  /** Plaintext API key — encrypted before storage; `null` clears it. */
  apiKey: string | null;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}>;

/**
 * Merge a validated patch into the global settings and persist it.
 * The plaintext `apiKey` (when provided) is encrypted and never stored or
 * logged in clear text. Returns the public (key-free) view. Caller audits.
 */
export async function updateAiGlobalSettings(
  patch: AiGlobalSettingsPatch,
  updatedBy: string
): Promise<AiGlobalSettingsPublic> {
  const current = await getAiGlobalSettings();
  const next: AiGlobalSettings = { ...current };

  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.providerType !== undefined) next.providerType = patch.providerType;
  if (patch.chatModel !== undefined) {
    next.chatModel = patch.chatModel.trim().slice(0, 100);
  }
  if (patch.embeddingModel !== undefined) {
    next.embeddingModel = patch.embeddingModel.trim().slice(0, 100);
  }
  if (patch.baseUrl !== undefined) {
    // Trim whitespace and trailing slashes so the stored value is directly
    // usable as "<base>/chat/completions" (adapter also normalizes).
    const normalized = patch.baseUrl.trim().replace(/\/+$/, "");
    next.baseUrl = normalized.slice(0, 500);
  }
  if (patch.apiKey !== undefined) {
    if (patch.apiKey === null) {
      // Explicit null clears the stored credential.
      next.apiKeyEncrypted = null;
    } else {
      const plaintext = patch.apiKey.trim();
      next.apiKeyEncrypted = plaintext.length > 0 ? encryptSecret(plaintext) : null;
    }
  }
  if (patch.temperature !== undefined) {
    next.temperature = clamp(patch.temperature, 0, 2);
  }
  if (patch.maxTokens !== undefined) {
    next.maxTokens = Math.round(clamp(patch.maxTokens, 50, 4000));
  }
  if (patch.timeoutMs !== undefined) {
    next.timeoutMs = Math.round(clamp(patch.timeoutMs, 5000, 120000));
  }

  await setSetting(AI_GLOBAL_KEY, { ...next }, updatedBy);
  return getAiGlobalSettingsPublic();
}

// --------------------------------------------------------------- resolvers --

/**
 * Effective chat model for the active provider.
 * builtin → the SDK's built-in model ("zai-builtin");
 * openai-compatible → the configured chat model (must be non-empty).
 */
export async function resolveChatModel(settings: AiGlobalSettings): Promise<string> {
  if (settings.providerType === "builtin") return DEFAULT_AI_GLOBAL_SETTINGS.chatModel;
  const model = settings.chatModel.trim();
  if (!model) {
    throw new Error("مدل گفتگو برای سرویس سازگار با OpenAI انتخاب نشده است.");
  }
  return model;
}

export async function isAiGloballyEnabled(): Promise<boolean> {
  const settings = await getAiGlobalSettings();
  return settings.enabled;
}
