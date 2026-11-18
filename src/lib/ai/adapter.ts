import "server-only";
import { decryptSecret } from "@/lib/crypto";
import { getAiGlobalSettings } from "./settings";
import type { AiGlobalSettings, ChatMessage, ChatOutcome, ChatParams } from "./types";

/**
 * Provider-adapter layer (AI-ARCHITECTURE §2).
 *
 * Two adapters implement the same interface:
 *  - builtin            → z-ai-web-dev-sdk (no key required)
 *  - openai-compatible  → any OpenAI-style /chat/completions endpoint
 *
 * Secrets policy: the API key is decrypted only inside this module, sent only
 * in the Authorization header, and never appears in error text or logs.
 */

export interface AiProviderAdapter {
  chat(model: string, messages: ChatMessage[], params?: ChatParams): Promise<ChatOutcome>;
  testConnection(): Promise<{ ok: boolean; detail: string; models: string[] }>;
}

export class AiDisabledError extends Error {}
export class AiConfigError extends Error {}

const BUILTIN_MODEL = "zai-builtin";

/** Shape of an OpenAI-style chat completion response (subset we consume). */
type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  model?: unknown;
};

/** Shape of an OpenAI-style GET /models response (subset we consume). */
type ModelsListResponse = {
  data?: Array<{ id?: unknown }>;
};

// ------------------------------------------------------------------ helpers --

function estimateTokens(text: number): number {
  return Math.max(1, Math.ceil(text / 4));
}

function extractContent(completion: ChatCompletionResponse | null): string {
  const content = completion?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function extractUsage(
  completion: ChatCompletionResponse | null,
  promptChars: number,
  completionChars: number
): { promptTokens: number; completionTokens: number } {
  const promptTokens =
    typeof completion?.usage?.prompt_tokens === "number" && completion.usage.prompt_tokens >= 0
      ? Math.round(completion.usage.prompt_tokens)
      : estimateTokens(promptChars);
  const completionTokens =
    typeof completion?.usage?.completion_tokens === "number" && completion.usage.completion_tokens >= 0
      ? Math.round(completion.usage.completion_tokens)
      : estimateTokens(completionChars);
  return { promptTokens, completionTokens };
}

/**
 * Reject with a Persian timeout error when `promise` does not settle in time.
 * The timer is always cleared to avoid keeping the event loop alive.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Strip anything resembling a credential from error text before it reaches
 * logs, audit metadata, or API responses (defense in depth — errors must be
 * constructed without secrets in the first place; this is the safety net).
 */
export function sanitizeSecrets(text: string, extraSecrets: string[] = []): string {
  let out = text;
  for (const secret of extraSecrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 6) out = out.split(trimmed).join("[REDACTED]");
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-[REDACTED]")
    .replace(/("api[-_]?key"\s*:\s*")[^"]{4,}(")/gi, "$1[REDACTED]$2");
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Format a number with Persian digits for user-facing details. */
function faNum(value: number): string {
  try {
    return new Intl.NumberFormat("fa-IR").format(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------- providers --

function createBuiltinAdapter(settings: AiGlobalSettings): AiProviderAdapter {
  async function chatViaSdk(
    messages: ChatMessage[],
    params?: ChatParams
  ): Promise<ChatOutcome> {
    // SDK convention (see z-ai-web-dev-sdk README): the system prompt is the
    // first message with role "assistant"; user/assistant turns use their
    // normal roles afterwards.
    const sdkMessages = messages.map((message) => ({
      role: message.role === "system" ? ("assistant" as const) : message.role,
      content: message.content,
    }));
    const promptChars = sdkMessages.reduce((sum, m) => sum + m.content.length, 0);

    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();

    const completion = (await withTimeout(
      zai.chat.completions.create({
        messages: sdkMessages,
        thinking: { type: "disabled" },
        ...(params?.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
      }),
      params?.timeoutMs ?? settings.timeoutMs,
      "پاسخ‌گویی سرویس هوش مصنوعی بیش از حد انتظار طول کشید."
    )) as unknown as ChatCompletionResponse;

    const content = extractContent(completion);
    if (!content) {
      throw new Error("پاسخ خالی از سرویس AI دریافت شد.");
    }

    // Prefer the SDK's real usage counters (observed in responses); fall back
    // to the chars/4 estimate when absent.
    const { promptTokens, completionTokens } = extractUsage(
      completion,
      promptChars,
      content.length
    );

    return { content, promptTokens, completionTokens, model: BUILTIN_MODEL };
  }

  return {
    chat(_model: string, messages: ChatMessage[], params?: ChatParams) {
      return chatViaSdk(messages, params);
    },

    async testConnection() {
      try {
        const outcome = await chatViaSdk(
          [
            { role: "system", content: "تست اتصال" },
            { role: "user", content: "سلام" },
          ],
          { maxTokens: 20, timeoutMs: Math.min(settings.timeoutMs, 30000) }
        );
        return {
          ok: !!outcome.content,
          detail: "اتصال به سرویس داخلی هوش مصنوعی برقرار است.",
          models: [BUILTIN_MODEL],
        };
      } catch (error) {
        return {
          ok: false,
          detail: `اتصال به سرویس داخلی برقرار نشد: ${sanitizeSecrets(errorDetail(error))}`,
          models: [BUILTIN_MODEL],
        };
      }
    },
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function createOpenAiCompatibleAdapter(settings: AiGlobalSettings): AiProviderAdapter {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);

  /** Resolve + validate credentials; throws AiConfigError when unusable. */
  function assertConfigured(): { baseUrl: string; apiKey: string } {
    if (!baseUrl) {
      throw new AiConfigError("آدرس Base URL تنظیم نشده است. ابتدا آدرس سرویس را در تنظیمات وارد کنید.");
    }
    const encrypted = settings.apiKeyEncrypted?.trim();
    if (!encrypted) {
      throw new AiConfigError("کلید API تنظیم نشده است. ابتدا کلید سرویس را در تنظیمات وارد کنید.");
    }
    const plaintext = decryptSecret(encrypted);
    if (!plaintext) {
      throw new AiConfigError("کلید API ذخیره‌شده قابل بازیابی نیست؛ لطفاً کلید را دوباره وارد کنید.");
    }
    return { baseUrl, apiKey: plaintext };
  }

  async function chat(
    model: string,
    messages: ChatMessage[],
    params?: ChatParams
  ): Promise<ChatOutcome> {
    const { baseUrl: urlBase, apiKey } = await assertConfigured();
    if (!model.trim()) {
      throw new AiConfigError("مدل گفتگو انتخاب نشده است.");
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      params?.timeoutMs ?? settings.timeoutMs
    );

    try {
      const response = await fetch(`${urlBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: params?.temperature ?? settings.temperature,
          max_tokens: params?.maxTokens ?? settings.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyExcerpt = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(
          `سرویس AI با کد وضعیت ${response.status} پاسخ داد.${
            bodyExcerpt ? ` جزئیات: ${sanitizeSecrets(bodyExcerpt, [apiKey])}` : ""
          }`
        );
      }

      const completion = (await response
        .json()
        .catch(() => null)) as unknown as ChatCompletionResponse | null;

      const content = extractContent(completion);
      if (!content) {
        throw new Error("پاسخ خالی از سرویس AI دریافت شد.");
      }

      const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      const { promptTokens, completionTokens } = extractUsage(
        completion,
        promptChars,
        content.length
      );

      return { content, promptTokens, completionTokens, model };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("زمان انتظار پاسخ از سرویس AI به پایان رسید.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function testConnection() {
    let credentials: { baseUrl: string; apiKey: string };
    try {
      credentials = await assertConfigured();
    } catch (error) {
      return {
        ok: false,
        detail: errorDetail(error),
        models: [],
      };
    }

    // Primary probe: GET /models (standard OpenAI-compatible endpoint).
    try {
      const response = await fetch(`${credentials.baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
        signal: AbortSignal.timeout(Math.min(settings.timeoutMs, 30000)),
      });

      if (response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as unknown as ModelsListResponse | null;
        const models = Array.isArray(payload?.data)
          ? payload.data
              .map((item) => (typeof item?.id === "string" ? item.id : ""))
              .filter((id) => id.length > 0)
              .slice(0, 50)
          : [];
        return {
          ok: true,
          detail: `اتصال به سرویس سازگار با OpenAI برقرار شد؛ ${faNum(models.length)} مدل در دسترس است.`,
          models,
        };
      }
      // 404/405 and friends → endpoint may not expose /models; fall through
      // to a minimal chat probe instead of failing outright.
    } catch {
      // Fall through to the chat probe.
    }

    // Fallback probe: tiny chat completion.
    try {
      const outcome = await chat(
        settings.chatModel.trim() || BUILTIN_MODEL,
        [
          { role: "system", content: "تست اتصال" },
          { role: "user", content: "سلام" },
        ],
        { maxTokens: 20, timeoutMs: Math.min(settings.timeoutMs, 30000) }
      );
      return {
        ok: !!outcome.content,
        detail: "اتصال برقرار شد؛ اما فهرست مدل‌های سرویس در دسترس نیست.",
        models: [],
      };
    } catch (error) {
      return {
        ok: false,
        detail: `اتصال به سرویس برقرار نشد: ${sanitizeSecrets(errorDetail(error), [credentials.apiKey])}`,
        models: [],
      };
    }
  }

  return { chat, testConnection };
}

// ------------------------------------------------------------------ factory --

export function createAdapter(settings: AiGlobalSettings): AiProviderAdapter {
  return settings.providerType === "openai-compatible"
    ? createOpenAiCompatibleAdapter(settings)
    : createBuiltinAdapter(settings);
}

/**
 * Resolve the active adapter from stored settings, enforcing the global
 * kill switch. Throws AiDisabledError when AI is turned off system-wide.
 */
export async function getActiveAdapter(): Promise<{
  adapter: AiProviderAdapter;
  settings: AiGlobalSettings;
}> {
  const settings = await getAiGlobalSettings();
  if (!settings.enabled) {
    throw new AiDisabledError("دستیار هوشمند در سطح سامانه غیرفعال است.");
  }
  return { adapter: createAdapter(settings), settings };
}
