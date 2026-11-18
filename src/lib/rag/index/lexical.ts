import "server-only";

import { db } from "@/lib/db";
import { scoreText, titleBoost, tokenize } from "@/lib/kb/text";
import { clamp01, type AccessScope, type Evidence } from "@/lib/rag/types";
import { authorizedCollectionIds } from "./scope";
import { chunkToEvidence, qaToEvidence } from "./evidence";

/**
 * RAG Engine — lexical retriever (task §4.A).
 *
 * Exact-term aware keyword scoring over the authorized corpus:
 *  - distinct-token coverage + occurrence density (same normalization on both
 *    sides of the index);
 *  - exact phrase bonus (multi-token queries matching verbatim);
 *  - identifier boost — regulation numbers / dates / codes matched verbatim
 *    (e.g. «بند ۱۲۳», «۱۴۰۳/۰۸/۱۵», «FR-2214») — these must win over fuzzy
 *    matches (acceptance criterion 2);
 *  - Q&A authority boost: a published official answer outranks document text
 *    at comparable coverage.
 *
 * The interface is intentionally narrow (`retrieve(query, scope, opts)`) so a
 * BM25/FTS implementation can replace the scorer without touching callers.
 */

export type LexicalOptions = {
  topK?: number;
  floor?: number;
};

export type LexicalResult = {
  evidence: Evidence[];
  candidatesScanned: number;
};

const MAX_QA_CANDIDATES = 300;
const MAX_CHUNK_CANDIDATES = 4000;
const MAX_CHUNK_CONTEXT_CHARS = 1500;

/** Regulation/identifier-like token: digits+separators or latin code. */
const IDENTIFIER_RE = /(?:\d+[\/\-.,،]\d+|\d{2,}|[A-Z]{2,}[-_]?\d+)/u;

export function extractIdentifiers(normalizedQuery: string): string[] {
  const matches = normalizedQuery.match(/\d+[\/\-.,،]\d+|\d{2,}|[a-z]{2,}[-_]?\d+/gu) ?? [];
  return Array.from(new Set(matches));
}

/** Exact verbatim phrase presence (multi-token queries only). */
function hasExactPhrase(normalizedCorpus: string, tokens: string[]): boolean {
  if (tokens.length < 2) return false;
  const phrase = tokens.join(" ");
  return normalizedCorpus.includes(phrase);
}

export async function lexicalRetrieve(
  query: string,
  scope: AccessScope,
  options?: LexicalOptions
): Promise<LexicalResult> {
  const topK = options?.topK ?? 20;
  const floor = options?.floor ?? 0.12;

  const normalizedQuery = query.trim();
  const tokens = Array.from(new Set(tokenize(normalizedQuery)));
  if (tokens.length === 0) return { evidence: [], candidatesScanned: 0 };
  const identifiers = extractIdentifiers(normalizedQuery);

  const authorizedIds = await authorizedCollectionIds(scope.departmentId);
  let scanned = 0;
  const results: Evidence[] = [];

  // ------------------------------------------------------------- Q&A scoring
  const qaEntries = await db.knowledgeQaEntry.findMany({
    where: {
      status: "PUBLISHED",
      departments: { some: { departmentId: scope.departmentId } },
    },
    include: { alternates: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_QA_CANDIDATES,
  });
  scanned += qaEntries.length;

  for (const entry of qaEntries) {
    let keywords: string[] = [];
    try {
      const parsed: unknown = JSON.parse(entry.keywords ?? "[]");
      if (Array.isArray(parsed)) {
        keywords = parsed.filter((k): k is string => typeof k === "string");
      }
    } catch {
      keywords = [];
    }
    const alternates = entry.alternates.map((a) => a.question);

    const questionCorpus = [entry.question, ...alternates, ...keywords].join(" ");
    const fullCorpus = [questionCorpus, entry.officialAnswer].join(" ");

    const { matchedTokens, occurrences } = scoreText(tokens, fullCorpus);
    if (matchedTokens === 0 && identifiers.length === 0) continue;
    const questionMatched = scoreText(tokens, questionCorpus).matchedTokens;

    const normalizedFull = fullCorpus.toLowerCase();
    const phraseHit = hasExactPhrase(normalizedFull, tokens) ? 0.15 : 0;
    const identifierHit =
      identifiers.length > 0 &&
      identifiers.some((id) => normalizedFull.includes(id.toLowerCase()))
        ? 0.25
        : 0;

    let score =
      0.45 * (matchedTokens / tokens.length) +
      0.25 * (questionMatched / tokens.length) +
      Math.min(0.15, occurrences * 0.01) +
      phraseHit +
      identifierHit;
    score = Math.min(1, score * 1.15); // authoritative Q&A boost, capped

    if (score < floor) continue;
    results.push(
      qaToEvidence(entry, { score: clamp01(score), lexicalScore: clamp01(score), semanticScore: null })
    );
  }

  // ----------------------------------------------------------- chunk scoring
  const chunks = await db.knowledgeChunk.findMany({
    where: {
      isActive: true,
      document: {
        status: "INDEXED",
        collectionId: { in: authorizedIds.length > 0 ? authorizedIds : ["__none__"] },
      },
    },
    orderBy: [{ document: { updatedAt: "desc" } }, { ordinal: "asc" }],
    take: MAX_CHUNK_CANDIDATES,
    select: {
      id: true,
      kind: true,
      text: true,
      normalized: true,
      headingPath: true,
      page: true,
      ordinal: true,
      parentId: true,
      createdAt: true,
      documentId: true,
      versionId: true,
      document: {
        select: {
          id: true,
          title: true,
          validUntil: true,
          sourceRef: true,
          collectionId: true,
          collection: { select: { access: true } },
          versions: { select: { versionNo: true } },
        },
      },
    },
  });
  scanned += chunks.length;

  for (const chunk of chunks) {
    const { matchedTokens, occurrences } = scoreText(tokens, chunk.normalized);
    if (matchedTokens === 0 && identifiers.length === 0) continue;

    const coverage = matchedTokens / tokens.length;
    const density = Math.min(1, occurrences / Math.max(1, chunk.normalized.length / 500));
    const phraseHit = hasExactPhrase(chunk.normalized, tokens) ? 0.12 : 0;
    const identifierHit =
      identifiers.length > 0 &&
      identifiers.some((id) => chunk.normalized.includes(id))
        ? 0.25
        : 0;
    // Child paragraphs are the precise units — mild structural preference.
    const kindBoost = chunk.kind === "PARAGRAPH" ? 0.06 : 0;

    let score =
      0.5 * coverage +
      0.25 * density +
      phraseHit +
      identifierHit +
      kindBoost;
    score += 0.08 * titleBoost(tokens, chunk.document.title);
    score = Math.min(1, score);

    if (score < floor) continue;
    results.push(
      chunkToEvidence(chunk, { score: clamp01(score), lexicalScore: clamp01(score), semanticScore: null })
    );
  }

  results.sort((a, b) => b.score - a.score);
  return {
    evidence: results.slice(0, topK).map((e) => ({
      ...e,
      text: e.text.slice(0, MAX_CHUNK_CONTEXT_CHARS),
    })),
    candidatesScanned: scanned,
  };
}
