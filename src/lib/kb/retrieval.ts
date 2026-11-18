/**
 * Knowledge Base — department-scoped keyword retrieval (deterministic
 * baseline, no provider calls).
 *
 * Hard scoping rules (KNOWLEDGE-BASE.md §2):
 *  - RESTRICTED collections and inactive collections are ALWAYS excluded;
 *  - GLOBAL collections are visible to every department; DEPARTMENT
 *    collections only when a grant row exists;
 *  - Q&A entries are always department-assigned (no global path) and only
 *    PUBLISHED entries are retrievable;
 *  - chunks come from INDEXED documents in authorized collections with
 *    isActive chunks only.
 */

import { db } from "@/lib/db";
import { scoreText, titleBoost, tokenize, normalizePersian } from "./text";
import type { RetrievalResult, RetrievalSourceRef } from "./types";

/** Max Q&A candidates scanned per retrieval (v1 scale). */
const MAX_QA_CANDIDATES = 200;
/** Max chunks scanned per retrieval (v1 scale — ordered by recency). */
const MAX_CHUNK_CANDIDATES = 2000;
/** Chunk text cap per context entry sent to the answering step. */
const MAX_CHUNK_CONTEXT_CHARS = 1200;

const DEFAULT_TOP_K = 5;
const DEFAULT_THRESHOLD = 0.35;

/** Safely parse a JSON string column that should hold an array of strings. */
function safeParseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

type ScoredSource = RetrievalSourceRef & {
  qa?: { id: string; question: string; officialAnswer: string };
  chunk?: { id: string; documentTitle: string; text: string };
};

/**
 * Retrieve the best knowledge sources for a department query.
 *
 * Scoring: coverage of distinct query tokens + occurrence density, with an
 * authoritative boost for Q&A entries (matches outrank document chunks).
 */
export async function retrieveForDepartment(
  departmentId: string,
  query: string,
  opts?: { topK?: number; threshold?: number }
): Promise<RetrievalResult> {
  const topK = opts?.topK ?? DEFAULT_TOP_K;
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const empty: RetrievalResult = {
    decision: "ABSTAINED_NO_EVIDENCE",
    confidence: 0,
    threshold,
    sources: [],
    qaContext: [],
    chunkContext: [],
  };

  const tokens = Array.from(new Set(tokenize(query)));
  if (tokens.length === 0) return empty;

  // ------------------------------------------------------- scope resolution
  // RESTRICTED + inactive collections are always excluded (hard filter).
  const authorizedCollections = await db.knowledgeCollection.findMany({
    where: {
      isActive: true,
      OR: [
        { access: "GLOBAL" },
        {
          access: "DEPARTMENT",
          departmentGrants: { some: { departmentId } },
        },
      ],
    },
    select: { id: true },
  });
  const authorizedIds = authorizedCollections.map((c) => c.id);

  const sources: ScoredSource[] = [];

  // ------------------------------------------------------------- Q&A scoring
  const qaEntries = await db.knowledgeQaEntry.findMany({
    where: {
      status: "PUBLISHED",
      departments: { some: { departmentId } },
    },
    include: { alternates: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_QA_CANDIDATES,
  });

  for (const entry of qaEntries) {
    const keywords = safeParseStringArray(entry.keywords);
    const alternates = entry.alternates.map((a) => a.question);

    const questionCorpus = normalizePersian(
      [entry.question, ...alternates, ...keywords].join(" ")
    );
    const fullCorpus = normalizePersian(
      [entry.question, ...alternates, ...keywords, entry.officialAnswer].join(" ")
    );

    const { matchedTokens, occurrences } = scoreText(tokens, fullCorpus);
    if (matchedTokens === 0) continue;
    const questionMatched = scoreText(tokens, questionCorpus).matchedTokens;

    let score =
      0.5 * (matchedTokens / tokens.length) +
      0.3 * (questionMatched / tokens.length) +
      Math.min(0.2, occurrences * 0.01);
    score = Math.min(1, score * 1.15); // authoritative boost, capped

    sources.push({
      kind: "QA",
      refId: entry.id,
      title: entry.question,
      score,
      qa: { id: entry.id, question: entry.question, officialAnswer: entry.officialAnswer },
    });
  }

  // ---------------------------------------------------------- chunk scoring
  // Ordered by recency of the parent document; fine at v1 scale.
  const chunks = await db.knowledgeChunk.findMany({
    where: {
      isActive: true,
      document: {
        status: "INDEXED",
        collectionId: { in: authorizedIds },
      },
    },
    orderBy: { document: { updatedAt: "desc" } },
    take: MAX_CHUNK_CANDIDATES,
    select: {
      id: true,
      text: true,
      normalized: true,
      document: { select: { title: true } },
    },
  });

  for (const chunk of chunks) {
    const { matchedTokens, occurrences } = scoreText(tokens, chunk.normalized);
    if (matchedTokens === 0) continue;

    const coverage = matchedTokens / tokens.length;
    const density = Math.min(
      1,
      occurrences / Math.max(1, chunk.normalized.length / 500)
    );
    let score = 0.6 * coverage + 0.4 * density;
    score += 0.1 * titleBoost(tokens, normalizePersian(chunk.document.title));
    score = Math.min(1, score);

    sources.push({
      kind: "CHUNK",
      refId: chunk.id,
      title: chunk.document.title,
      score,
      chunk: {
        id: chunk.id,
        documentTitle: chunk.document.title,
        text: chunk.text.slice(0, MAX_CHUNK_CONTEXT_CHARS),
      },
    });
  }

  // ---------------------------------------------------------------- ranking
  sources.sort((a, b) => b.score - a.score);
  const top = sources.slice(0, topK);
  const best = top.length > 0 ? top[0]!.score : 0;

  let decision: RetrievalResult["decision"];
  if (best === 0) decision = "ABSTAINED_NO_EVIDENCE";
  else if (best < threshold) decision = "ABSTAINED_LOW_SCORE";
  else decision = "ANSWERED";

  return {
    decision,
    confidence: best,
    threshold,
    sources: top.map(({ kind, refId, title, score }) => ({ kind, refId, title, score })),
    qaContext: top.flatMap((s) => (s.qa ? [s.qa] : [])),
    chunkContext: top.flatMap((s) => (s.chunk ? [s.chunk] : [])),
  };
}
