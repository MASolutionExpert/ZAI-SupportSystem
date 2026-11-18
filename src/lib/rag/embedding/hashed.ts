/**
 * RAG Engine — deterministic builtin embedding (`hashed-fa-v1`).
 *
 * The sandbox's builtin provider exposes no embeddings endpoint, so the
 * offline default embeds text into a fixed-dimension vector via the hashing
 * trick over character n-grams of the *normalized* Persian text (character
 * n-grams tolerate inflection and half-space variants where word tokens
 * break). Deterministic: the same text always yields the same vector, and
 * re-embedding after a restart is a no-op.
 *
 * This is an IRM/similarity fallback, NOT a true semantic model — paraphrase
 * recall is materially weaker than a real embedding endpoint. Production
 * deployments configure an OpenAI-compatible `/embeddings` provider in the
 * admin panel; the engine detects the model change and re-embeds through the
 * job queue (see ingest/pipeline.ts).
 */

import { normalizePersian } from "@/lib/kb/text";

export const HASHED_EMBEDDING_MODEL = "hashed-fa-v1";
export const HASHED_EMBEDDING_DIM = 384;

/** FNV-1a 32-bit — fast, deterministic, well-distributed for hashing tricks. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Character n-grams (2..4) of a normalized token, edge-padded. */
function* charGrams(token: string): Generator<string> {
  const padded = `^${token}$`;
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= padded.length; i++) {
      yield padded.slice(i, i + n);
    }
  }
  yield token;
}

/**
 * Embed one normalized text into a unit-length vector.
 * Weighting: distinct features (dedup per text) with sublinear frequency.
 */
export function hashedEmbed(normalizedText: string): number[] {
  const vector = new Float64Array(HASHED_EMBEDDING_DIM);
  const tokens = normalizedText.split(" ").filter((t) => t.length > 1);
  const seen = new Map<string, number>();

  for (const token of tokens) {
    for (const gram of charGrams(token)) {
      seen.set(gram, (seen.get(gram) ?? 0) + 1);
    }
  }

  for (const [feature, count] of seen) {
    const hash = fnv1a(feature);
    const index = hash % HASHED_EMBEDDING_DIM;
    const sign = (hash >>> 31) === 1 ? -1 : 1;
    // Sublinear term frequency damping — long boilerplate must not dominate.
    const weight = sign * (1 + Math.log(count));
    vector[index] += weight;
  }

  let norm = 0;
  for (let i = 0; i < HASHED_EMBEDDING_DIM; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(vector);
  const out = new Array<number>(HASHED_EMBEDDING_DIM);
  for (let i = 0; i < HASHED_EMBEDDING_DIM; i++) out[i] = vector[i] / norm;
  return out;
}

/** Cosine similarity for two equal-dimension vectors (inputs unit-normalized). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot; // unit vectors ⇒ dot = cosine
}
