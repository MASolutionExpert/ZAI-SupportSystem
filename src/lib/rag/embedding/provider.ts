import "server-only";

import { decryptSecret } from "@/lib/crypto";
import { getAiGlobalSettings } from "@/lib/ai/settings";
import { AiConfigError } from "@/lib/ai/adapter";
import { getRagEngineSettings } from "@/lib/rag/config";
import {
  HASHED_EMBEDDING_DIM,
  HASHED_EMBEDDING_MODEL,
  hashedEmbed,
} from "./hashed";
import { normalizePersian } from "@/lib/kb/text";

/**
 * RAG Engine — replaceable embedding provider layer.
 *
 * Two implementations behind one interface:
 *  - builtin-hashed      → deterministic offline fallback (hashed-fa-v1)
 *  - openai-compatible   → POST {baseUrl}/embeddings using the chat provider's
 *                          stored credentials (same encrypted key material)
 *
 * Every embed result carries the resolved (model, dim) pair — callers write it
 * onto indexed chunks so the vector search can refuse mismatched combinations
 * (task §4.B: no silent incompatible-vector search).
 */

export type EmbeddingRequest = { ok: true; vectors: number[][]; model: string; dim: number } | {
  ok: false;
  error: string;
};

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dim: number;
  /** Batch-embed texts. Implementations MUST NOT reorder or drop items. */
  embed(texts: string[]): Promise<EmbeddingRequest>;
}

// ------------------------------------------------------------- builtin-hashed --

function createHashedProvider(): EmbeddingProvider {
  return {
    id: "builtin-hashed",
    model: HASHED_EMBEDDING_MODEL,
    dim: HASHED_EMBEDDING_DIM,
    async embed(texts: string[]): Promise<EmbeddingRequest> {
      return {
        ok: true,
        vectors: texts.map((text) => hashedEmbed(normalizePersian(text))),
        model: HASHED_EMBEDDING_MODEL,
        dim: HASHED_EMBEDDING_DIM,
      };
    },
  };
}

// --------------------------------------------------------- openai-compatible --

type EmbeddingsApiResponse = {
  data?: Array<{ index?: unknown; embedding?: unknown }>;
};

function extractVectors(payload: EmbeddingsApiResponse | null, expectedCount: number): number[][] | null {
  if (!payload || !Array.isArray(payload.data)) return null;
  const byIndex: (number[] | null)[] = new Array(expectedCount).fill(null);
  for (const item of payload.data) {
    if (
      typeof item?.index === "number" &&
      item.index >= 0 &&
      item.index < expectedCount &&
      Array.isArray(item.embedding) &&
      item.embedding.every((v) => typeof v === "number")
    ) {
      byIndex[item.index] = item.embedding as number[];
    }
  }
  if (byIndex.some((v) => v === null)) return null;
  return byIndex as number[][];
}

function createOpenAiCompatibleProvider(model: string): EmbeddingProvider {
  const expectedDim: number | null = null; // learned from the first response

  async function assertCredentials(): Promise<{ baseUrl: string; apiKey: string }> {
    const aiSettings = await getAiGlobalSettings();
    const baseUrl = aiSettings.baseUrl?.trim().replace(/\/+$/, "") ?? "";
    if (!baseUrl) {
      throw new AiConfigError(
        "برای امبدینگ سازگار با OpenAI، آدرس Base URL در تنظیمات AI ثبت نشده است."
      );
    }
    const encrypted = aiSettings.apiKeyEncrypted?.trim();
    if (!encrypted) {
      throw new AiConfigError("کلید API برای امبدینگ تنظیم نشده است.");
    }
    const apiKey = decryptSecret(encrypted);
    if (!apiKey) {
      throw new AiConfigError("کلید API ذخیره‌شده قابل بازیابی نیست.");
    }
    return { baseUrl, apiKey };
  }

  return {
    id: "openai-compatible",
    model,
    dim: expectedDim ?? 0, // resolved dynamically; embed() reports the real dim
    async embed(texts: string[]): Promise<EmbeddingRequest> {
      try {
        const { baseUrl, apiKey } = await assertCredentials();
        const response = await fetch(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, input: texts }),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          const excerpt = (await response.text().catch(() => "")).slice(0, 200);
          return {
            ok: false,
            error: `سرویس امبدینگ با کد ${response.status} پاسخ داد${excerpt ? `: ${excerpt}` : ""}`,
          };
        }
        const vectors = extractVectors(
          (await response.json().catch(() => null)) as EmbeddingsApiResponse | null,
          texts.length
        );
        if (!vectors) {
          return { ok: false, error: "ساختار پاسخ سرویس امبدینگ معتبر نیست." };
        }
        const dim = vectors[0]?.length ?? 0;
        return { ok: true, vectors, model, dim };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `امبدینگ ناموفق بود: ${detail}` };
      }
    },
  };
}

/**
 * Resolve the active embedding provider from engine settings.
 * Never throws for a missing openai-compatible configuration — the engine
 * degrades to lexical-only retrieval when the provider reports failure.
 */
export async function getActiveEmbeddingProvider(): Promise<EmbeddingProvider> {
  const settings = await getRagEngineSettings();
  if (settings.embeddings.provider === "openai-compatible" && settings.embeddings.model) {
    return createOpenAiCompatibleProvider(settings.embeddings.model);
  }
  return createHashedProvider();
}

export { createHashedProvider, createOpenAiCompatibleProvider };
