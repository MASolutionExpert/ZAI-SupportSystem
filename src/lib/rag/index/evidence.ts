import "server-only";

import type { Evidence } from "@/lib/rag/types";

/**
 * RAG Engine — evidence assembly. Maps authorized DB rows (chunks / Q&A
 * entries) onto the engine's `Evidence` contract with full provenance. All
 * fields arriving here have already passed the access-scope SQL filter.
 */

type ChunkRow = {
  id: string;
  kind: string;
  text: string;
  headingPath: string | null;
  page: number | null;
  ordinal: number;
  parentId: string | null;
  createdAt: Date;
  documentId: string;
  versionId: string;
  document: {
    id: string;
    title: string;
    validUntil: Date | null;
    sourceRef: string | null;
    collectionId: string;
    collection: { access: string };
    versions: { versionNo: number }[];
  };
};

type QaRow = {
  id: string;
  question: string;
  officialAnswer: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Version number of the chunk's document (highest = current). */
function resolveVersionNo(row: ChunkRow): number | null {
  const versions = row.document.versions ?? [];
  return versions.length > 0
    ? versions.reduce((max, v) => Math.max(max, v.versionNo), 0)
    : null;
}

export function chunkToEvidence(
  row: ChunkRow,
  scores: { score: number; lexicalScore: number; semanticScore: number | null }
): Evidence {
  return {
    id: row.id,
    kind: row.kind === "SECTION" ? "SECTION" : "PARAGRAPH",
    score: scores.score,
    lexicalScore: scores.lexicalScore,
    semanticScore: scores.semanticScore,
    documentId: row.documentId,
    documentTitle: row.document.title,
    documentVersionNo: resolveVersionNo(row),
    versionId: row.versionId,
    collectionId: row.document.collectionId,
    collectionAccess:
      row.document.collection.access === "GLOBAL" ||
      row.document.collection.access === "DEPARTMENT" ||
      row.document.collection.access === "RESTRICTED"
        ? row.document.collection.access
        : null,
    headingPath: row.headingPath,
    page: row.page,
    ordinal: row.ordinal,
    indexedAt: row.createdAt.toISOString(),
    text: row.text,
    parentText: null,
    validUntil: row.document.validUntil ? row.document.validUntil.toISOString() : null,
    sourceRef: row.document.sourceRef,
  };
}

export function qaToEvidence(
  row: QaRow,
  scores: { score: number; lexicalScore: number; semanticScore: number | null }
): Evidence {
  return {
    id: row.id,
    kind: "QA",
    score: scores.score,
    lexicalScore: scores.lexicalScore,
    semanticScore: scores.semanticScore,
    documentId: null,
    documentTitle: "پرسش‌وپاسخ رسمی سازمان",
    documentVersionNo: null,
    versionId: null,
    collectionId: null,
    collectionAccess: null,
    headingPath: null,
    page: null,
    ordinal: null,
    indexedAt: row.updatedAt.toISOString(),
    qaId: row.id,
    qaQuestion: row.question,
    text: row.officialAnswer,
    parentText: null,
    validUntil: null,
    sourceRef: null,
  };
}
