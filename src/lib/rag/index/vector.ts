import "server-only";

import { db } from "@/lib/db";
import { clamp01, type AccessScope, type Evidence } from "@/lib/rag/types";
import { getActiveEmbeddingProvider } from "@/lib/rag/embedding/provider";
import { cosineSimilarity } from "@/lib/rag/embedding/hashed";
import { authorizedCollectionIds } from "./scope";
import { chunkToEvidence } from "./evidence";

/**
 * RAG Engine — semantic (vector) retriever behind the `VectorIndex` seam
 * (task §4.B).
 *
 * SQLiteJsonVectorIndex: embeddings live as JSON columns on authorized chunks;
 * cosine similarity runs in-process over the scoped candidate set. The same
 * interface accepts a PostgreSQL + pgvector implementation later without any
 * change to retrieval logic (docs/RAG-ENGINE.md §5.2).
 *
 * Embedding-model safety: a chunk is searchable ONLY when its stored
 * (embeddingModel, embeddingDim) matches the ACTIVE provider's exactly —
 * vectors from an incompatible model are never compared against the query
 * vector (they are silently excluded here, and the admin panel exposes the
 * mismatch rate for re-embedding).
 */

export type VectorIndex = {
  readonly id: string;
  search(
    query: string,
    scope: AccessScope,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult>;
};

export type VectorSearchOptions = {
  topK?: number;
  floor?: number;
};

export type VectorSearchResult = {
  evidence: Evidence[];
  model: string | null;
  dim: number | null;
  /** Chunks skipped because their embedding model/dim mismatches. */
  incompatibleSkipped: number;
  candidatesScanned: number;
};

const MAX_VECTOR_CANDIDATES = 4000;

export class JsonInMemoryVectorIndex implements VectorIndex {
  /** Provider-neutral id: JSON-stored embeddings scored in-process. */
  readonly id = "json-cosine";

  async search(
    query: string,
    scope: AccessScope,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult> {
    const topK = options?.topK ?? 20;
    const floor = options?.floor ?? 0.55;

    const provider = await getActiveEmbeddingProvider();
    const queryEmbedding = await provider.embed([query]);
    if (!queryEmbedding.ok) {
      // Provider outage ⇒ semantic path contributes nothing; lexical path still works.
      return {
        evidence: [],
        model: provider.model,
        dim: provider.dim,
        incompatibleSkipped: 0,
        candidatesScanned: 0,
      };
    }
    const queryVector = queryEmbedding.vectors[0]!;
    const model = queryEmbedding.model;
    const dim = queryEmbedding.vectors[0]!.length;

    const authorizedIds = await authorizedCollectionIds(scope.departmentId);
    if (authorizedIds.length === 0) {
      return { evidence: [], model, dim, incompatibleSkipped: 0, candidatesScanned: 0 };
    }

    const chunks = await db.knowledgeChunk.findMany({
      where: {
        isActive: true,
        embeddingModel: model, // hard model match — no silent incompatible search
        embeddingDim: dim, // hard dimension match
        document: {
          status: "INDEXED",
          collectionId: { in: authorizedIds },
        },
      },
      orderBy: [{ document: { updatedAt: "desc" } }, { ordinal: "asc" }],
      take: MAX_VECTOR_CANDIDATES,
      select: {
        id: true,
        kind: true,
        text: true,
        headingPath: true,
        page: true,
        ordinal: true,
        parentId: true,
        createdAt: true,
        documentId: true,
        versionId: true,
        embedding: true,
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

    // Mismatch bookkeeping: same model name but stale dim (or vice versa).
    const mismatched = await db.knowledgeChunk.count({
      where: {
        isActive: true,
        document: {
          status: "INDEXED",
          collectionId: { in: authorizedIds },
        },
        OR: [
          { embeddingModel: { not: model } },
          { embeddingModel: null },
          { embeddingDim: { not: dim } },
          { embeddingDim: null },
        ],
      },
    });

    const scored: Array<{ row: (typeof chunks)[number]; similarity: number }> = [];
    for (const row of chunks) {
      if (!row.embedding) continue;
      try {
        const vector = JSON.parse(row.embedding) as number[];
        if (!Array.isArray(vector) || vector.length !== dim) continue;
        const similarity = cosineSimilarity(queryVector, vector);
        if (similarity >= floor) scored.push({ row, similarity });
      } catch {
        continue; // corrupt embedding JSON — excluded, never searched
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);

    return {
      evidence: scored.slice(0, topK).map(({ row, similarity }) =>
        chunkToEvidence(row, {
          score: clamp01(similarity),
          lexicalScore: 0,
          semanticScore: clamp01(similarity),
        })
      ),
      model,
      dim,
      incompatibleSkipped: mismatched,
      candidatesScanned: chunks.length,
    };
  }
}

/** Factory — the swap point for a pgvector implementation. */
export function createVectorIndex(): VectorIndex {
  return new JsonInMemoryVectorIndex();
}
