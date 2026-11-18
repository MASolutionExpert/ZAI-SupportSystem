import "server-only";

/**
 * RAG Engine — document ingestion pipeline (Stage 2).
 *
 * One code path for upload / replace / reprocess: extract (structure-aware)
 * → plan parent/child chunks → embed (replaceable provider) → persist within
 * a single transaction (stale chunks wiped — no duplicate or orphan index) →
 * INDEXED. Any failure marks the document FAILED with a visible Persian
 * `statusError` — a partially-indexed document can never exist, and a
 * document is not visible to AI until this pipeline completes successfully.
 *
 * Every chunk persists full provenance: version, heading path, page, ordinal,
 * embedding model + dim (model-mismatched vectors are excluded at retrieval,
 * never silently mixed).
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { readKbFile } from "@/lib/kb/store";
import { getActiveEmbeddingProvider } from "@/lib/rag/embedding/provider";
import { extractDocumentStructure } from "./extract";
import { planChunks } from "./chunker";
import type { KbActor } from "@/lib/kb/pipeline";
import type { KbDocumentStatus } from "@/lib/kb/types";

const GENERIC_PROCESS_ERROR = "پردازش سند با خطای غیرمنتظره متوقف شد.";
/** Embedding batch size per provider call. */
const EMBED_BATCH = 32;

export type IngestOutcome = {
  status: KbDocumentStatus;
  error?: string;
  chunks?: number;
  sections?: number;
  children?: number;
  embeddingModel?: string | null;
};

type DocumentRow = {
  id: string;
  mimeType: string;
  storageKey: string;
  title: string;
  versions: { id: string; versionNo: number; storageKey: string }[];
};

async function loadDocument(documentId: string): Promise<DocumentRow | null> {
  return db.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      mimeType: true,
      storageKey: true,
      title: true,
      versions: { select: { id: true, versionNo: true, storageKey: true } },
    },
  });
}

function resolveActiveVersion(document: DocumentRow): DocumentRow["versions"][number] {
  const active =
    document.versions.find((v) => v.storageKey === document.storageKey) ??
    document.versions.reduce<DocVersion | null>(
      (best, v) => (!best || v.versionNo > best.versionNo ? v : best),
      null
    );
  if (!active) throw new Error("نسخه فعال سند یافت نشد.");
  return active;
}

type DocVersion = { id: string; versionNo: number; storageKey: string };

/** Move a document to FAILED with a visible Persian error + audit. */
export async function failDocument(
  documentId: string,
  error: string,
  actor: KbActor
): Promise<void> {
  try {
    await db.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "FAILED", statusError: error },
    });
  } catch (updateError) {
    console.error("[rag/ingest] failed to persist FAILED status:", updateError);
  }
  await audit({
    actorType: actor.id === "system" ? "SYSTEM" : "USER",
    actorUserId: actor.id === "system" ? undefined : actor.id,
    actorLabel: actor.label,
    action: "kb.document.failed",
    entityType: "KnowledgeDocument",
    entityId: documentId,
    metadata: { documentId, error, engine: "rag" },
  });
}

/** Batch-embed texts; surfaces provider failure as an explicit error. */
async function embedTexts(
  texts: string[]
): Promise<{ vectors: number[][]; model: string; dim: number }> {
  const provider = await getActiveEmbeddingProvider();
  const vectors: number[][] = [];
  let model = provider.model;
  let dim = provider.dim;

  for (let offset = 0; offset < texts.length; offset += EMBED_BATCH) {
    const batch = texts.slice(offset, offset + EMBED_BATCH);
    const result = await provider.embed(batch);
    if (!result.ok) {
      throw new Error(`امبدینگ سند ناموفق بود: ${result.error}`);
    }
    if (dim === 0) dim = result.dim;
    if (result.dim !== dim) {
      throw new Error("ابعاد ناسازگار در پاسخ سرویس امبدینگ.");
    }
    model = result.model;
    vectors.push(...result.vectors);
  }

  if (vectors.length !== texts.length) {
    throw new Error("تعداد بردارهای امبدینگ با ورودی هم‌خوان نیست.");
  }
  return { vectors, model, dim };
}

/**
 * Full synchronous ingest for one document. Called by the job runner and by
 * upload/replace/reprocess paths. Idempotent: re-running rebuilds the index.
 */
export async function ingestDocumentNow(
  documentId: string,
  actor: KbActor
): Promise<IngestOutcome> {
  let document: DocumentRow | null = null;
  try {
    document = await loadDocument(documentId);
    if (!document) {
      return { status: "FAILED", error: "سند یافت نشد." };
    }

    await db.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "PROCESSING", statusError: null },
    });

    const activeVersion = resolveActiveVersion(document);
    const bytes = await readKbFile(document.storageKey);

    // ---------------------------------------------------- extraction (structured)
    const extracted = await extractDocumentStructure(bytes, document.mimeType);
    if (!extracted.ok) {
      await failDocument(documentId, extracted.error, actor);
      return { status: "FAILED", error: extracted.error };
    }

    // ---------------------------------------------------- chunk planning
    let plan;
    try {
      plan = planChunks(extracted.blocks);
    } catch (planError) {
      const message =
        planError instanceof Error && planError.message
          ? planError.message
          : "برش ساختاری سند ناموفق بود.";
      await failDocument(documentId, message, actor);
      return { status: "FAILED", error: message };
    }
    if (plan.chunks.length === 0) {
      const error = "هیچ بخش قابل فهرست‌سازی از سند استخراج نشد.";
      await failDocument(documentId, error, actor);
      return { status: "FAILED", error };
    }

    // ---------------------------------------------------- embeddings
    const { vectors, model, dim } = await embedTexts(plan.chunks.map((c) => c.embedText));

    // ---------------------------------------------------- persist (atomic)
    const sectionIds = new Map<number, string>();
    let sectionRows = 0;
    let childRows = 0;

    await db.$transaction(async (tx) => {
      // Stale index removal: every chunk of this document (any version).
      await tx.knowledgeChunk.deleteMany({ where: { documentId } });

      // Parents first (children reference their ids).
      for (const chunk of plan.chunks) {
        if (chunk.kind !== "SECTION") continue;
        const created = await tx.knowledgeChunk.create({
          data: {
            documentId,
            versionId: activeVersion.id,
            ordinal: chunk.ordinal,
            kind: "SECTION",
            headingPath: chunk.headingPath,
            page: chunk.page,
            text: chunk.text,
            normalized: chunk.normalized,
            embedding: JSON.stringify(vectors[chunk.ordinal]),
            embeddingModel: model,
            embeddingDim: dim,
            isActive: true,
          },
          select: { id: true },
        });
        sectionIds.set(chunk.ordinal, created.id);
        sectionRows++;
      }

      for (const chunk of plan.chunks) {
        if (chunk.kind !== "PARAGRAPH") continue;
        const parentId = chunk.parentOrdinal !== null ? sectionIds.get(chunk.parentOrdinal) : null;
        await tx.knowledgeChunk.create({
          data: {
            documentId,
            versionId: activeVersion.id,
            ordinal: chunk.ordinal,
            kind: "PARAGRAPH",
            parentId: parentId ?? null,
            headingPath: chunk.headingPath,
            page: chunk.page,
            text: chunk.text,
            normalized: chunk.normalized,
            embedding: JSON.stringify(vectors[chunk.ordinal]),
            embeddingModel: model,
            embeddingDim: dim,
            isActive: true,
          },
        });
        childRows++;
      }

      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: "INDEXED",
          statusError: null,
          extractedChars: extracted.chars,
          chunkCount: plan.chunks.length,
        },
      });
    });

    await audit({
      actorType: actor.id === "system" ? "SYSTEM" : "USER",
      actorUserId: actor.id === "system" ? undefined : actor.id,
      actorLabel: actor.label,
      action: "kb.document.indexed",
      entityType: "KnowledgeDocument",
      entityId: documentId,
      metadata: {
        documentId,
        engine: "rag",
        chunks: plan.chunks.length,
        sections: sectionRows,
        children: childRows,
        embeddingModel: model,
        embeddingDim: dim,
        chars: extracted.chars,
      },
    });

    return {
      status: "INDEXED",
      chunks: plan.chunks.length,
      sections: sectionRows,
      children: childRows,
      embeddingModel: model,
    };
  } catch (error) {
    console.error("[rag/ingest] ingestDocumentNow failed:", error);
    const message =
      error instanceof Error && /امبدینگ|قطعه|ابعاد/.test(error.message)
        ? error.message
        : GENERIC_PROCESS_ERROR;
    if (document) await failDocument(documentId, message, actor);
    return { status: "FAILED", error: message };
  }
}

// ------------------------------------------------------------------ re-embed --

export type ReembedScope = {
  documentId?: string;
  collectionId?: string;
  /** true → every indexed document (model-change rebuild). */
  all?: boolean;
};

/**
 * Re-embed indexed chunks with the ACTIVE provider. Used after an embedding
 * model change or provider swap; chunks are batched through the job queue for
 * large scopes. Returns counters for the admin report.
 */
export async function reembedChunks(
  scope: ReembedScope,
  actor: KbActor
): Promise<{ scanned: number; embedded: number; model: string; dim: number }> {
  const where = {
    isActive: true,
    document: {
      status: "INDEXED" as const,
      ...(scope.documentId ? { id: scope.documentId } : {}),
      ...(scope.collectionId ? { collectionId: scope.collectionId } : {}),
    },
  };

  const chunks = await db.knowledgeChunk.findMany({
    where,
    select: { id: true, headingPath: true, text: true },
    orderBy: { createdAt: "asc" },
  });

  if (chunks.length === 0) {
    return { scanned: 0, embedded: 0, model: "n/a", dim: 0 };
  }

  const provider = await getActiveEmbeddingProvider();
  let model = provider.model;
  let dim = provider.dim;
  let embedded = 0;

  for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH) {
    const batch = chunks.slice(offset, offset + EMBED_BATCH);
    const texts = batch.map((chunk) =>
      [chunk.headingPath ?? "", chunk.text].filter(Boolean).join("\n").slice(0, 3000)
    );
    const result = await provider.embed(texts);
    if (!result.ok) {
      throw new Error(`امبدینگ مجدد ناموفق بود: ${result.error}`);
    }
    if (dim === 0) dim = result.dim;
    model = result.model;

    await db.$transaction(async (tx) => {
      for (let i = 0; i < batch.length; i++) {
        await tx.knowledgeChunk.update({
          where: { id: batch[i]!.id },
          data: {
            embedding: JSON.stringify(result.vectors[i]),
            embeddingModel: model,
            embeddingDim: dim,
          },
        });
      }
    });
    embedded += batch.length;
  }

  await audit({
    actorType: actor.id === "system" ? "SYSTEM" : "USER",
    actorUserId: actor.id === "system" ? undefined : actor.id,
    actorLabel: actor.label,
    action: "rag.index.reembedded",
    entityType: "KnowledgeChunk",
    metadata: {
      scope: scope.all ? "all" : scope.documentId ? scope.documentId : scope.collectionId,
      scanned: chunks.length,
      embedded,
      model,
      dim,
    },
  });

  return { scanned: chunks.length, embedded, model, dim };
}

/** Convenience for scripts/demo seeding: ingest with a SYSTEM actor. */
export const SYSTEM_INGEST_ACTOR: KbActor = { id: "system", label: "rag-worker" };
