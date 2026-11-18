/**
 * Knowledge Base — document pipeline: upload / process / replace / delete.
 *
 * The pipeline is the only place that mutates document status, chunks and
 * stored files. Extraction failures are first-class: the document visibly
 * moves to FAILED with a Persian statusError — never a silent partial index.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";
import {
  deleteKbFile,
  kbStorageRelativePath,
  writeKbFile,
} from "./store";
import {
  KB_ALLOWED_MIME,
  KB_MAX_DOCUMENT_BYTES,
  type KbDocumentStatus,
} from "./types";

export type KbActor = { id: string; label: string };

/** Validation failure with a user-facing Persian message + HTTP status. */
export class KbInputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "KbInputError";
    this.status = status;
  }
}

/** Input for upload / replace operations. */
export type KbUploadFile = {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
};

export const GENERIC_PROCESS_ERROR = "پردازش سند با خطای غیرمنتظره متوقف شد.";

function assertMimeAllowed(mimeType: string): void {
  if (!(KB_ALLOWED_MIME as readonly string[]).includes(mimeType)) {
    throw new KbInputError(
      "قالب فایل مجاز نیست؛ فرمت‌های مجاز: PDF، Word (docx)، Excel (xlsx)، متن ساده (txt) و Markdown (md).",
      422
    );
  }
}

function assertSizeAllowed(buffer: Buffer): void {
  if (buffer.length > KB_MAX_DOCUMENT_BYTES) {
    throw new KbInputError(
      "حجم فایل بیش از حد مجاز است (حداکثر ۱۵ مگابایت).",
      413
    );
  }
  if (buffer.length === 0) {
    throw new KbInputError("فایل ارسال‌شده خالی است.", 422);
  }
}

/** Validate upload prerequisites shared by create/replace. */
function assertUploadAllowed(file: KbUploadFile): void {
  assertMimeAllowed(file.mimeType);
  assertSizeAllowed(file.buffer);
}

// ------------------------------------------------------------------ process

/**
 * Re-index a document through the RAG engine's structured pipeline (extract
 * → parent/child chunks → embeddings → atomic index rebuild). Delegate kept
 * under the legacy name so existing admin routes stay unchanged; failure
 * behavior is identical (FAILED + visible Persian statusError).
 *
 * Allowed from any status.
 */
export async function processDocument(
  documentId: string,
  actor: KbActor
): Promise<{ status: KbDocumentStatus; error?: string }> {
  const { ingestDocumentNow } = await import("@/lib/rag/ingest/pipeline");
  const outcome = await ingestDocumentNow(documentId, actor);
  return { status: outcome.status, error: outcome.error };
}

/** Move a document to FAILED with a visible Persian status error + audit. */
async function failDocument(
  documentId: string,
  error: string,
  actor: KbActor
): Promise<void> {
  const { failDocument: failIngest } = await import("@/lib/rag/ingest/pipeline");
  await failIngest(documentId, error, actor);
}

// ------------------------------------------------------------------- create

export async function createDocumentFromUpload(input: {
  file: KbUploadFile;
  title: string;
  collectionId: string;
  uploadedBy: string;
  uploadedByLabel: string;
}): Promise<{ documentId: string; status: KbDocumentStatus; error?: string }> {
  const { file, title, collectionId, uploadedBy, uploadedByLabel } = input;
  assertUploadAllowed(file);

  const collection = await db.knowledgeCollection.findUnique({
    where: { id: collectionId },
    select: { id: true },
  });
  if (!collection) {
    throw new KbInputError("مجموعه دانش انتخاب‌شده یافت نشد.", 404);
  }

  const documentId = randomUUID();
  const checksum = sha256Hex(file.buffer);
  const storageKey = kbStorageRelativePath(file.originalFilename, documentId, file.mimeType);

  try {
    await writeKbFile(file.buffer, storageKey);

    await db.$transaction(async (tx) => {
      await tx.knowledgeDocument.create({
        data: {
          id: documentId,
          collectionId,
          title,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          checksum,
          storageKey,
          status: "UPLOADED",
          uploadedBy,
        },
      });
      await tx.knowledgeDocumentVersion.create({
        data: {
          documentId,
          versionNo: 1,
          storageKey,
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          checksum,
          uploadedBy,
        },
      });
    });
  } catch (error) {
    // Keep storage consistent with the DB: remove the orphan file.
    await deleteKbFile(storageKey);
    throw error;
  }

  await audit({
    actorType: "USER",
    actorUserId: uploadedBy,
    actorLabel: uploadedByLabel,
    action: "kb.document.uploaded",
    entityType: "KnowledgeDocument",
    entityId: documentId,
    metadata: {
      documentId,
      filename: file.originalFilename,
      sizeBytes: file.buffer.length,
      mimeType: file.mimeType,
    },
  });

  const processed = await processDocument(documentId, {
    id: uploadedBy,
    label: uploadedByLabel,
  });
  return { documentId, ...processed };
}

// ------------------------------------------------------------------ replace

export async function replaceDocumentVersion(input: {
  documentId: string;
  file: KbUploadFile;
  uploadedBy: string;
  uploadedByLabel: string;
}): Promise<{ status: KbDocumentStatus; error?: string }> {
  const { file, documentId, uploadedBy, uploadedByLabel } = input;
  assertUploadAllowed(file);

  const document = await db.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      versions: { select: { versionNo: true } },
    },
  });
  if (!document) {
    throw new KbInputError("سند یافت نشد.", 404);
  }

  const nextVersionNo =
    document.versions.reduce((max, v) => Math.max(max, v.versionNo), 0) + 1;
  const checksum = sha256Hex(file.buffer);
  const versionId = randomUUID();
  const storageKey = kbStorageRelativePath(file.originalFilename, versionId, file.mimeType);

  try {
    await writeKbFile(file.buffer, storageKey);

    await db.$transaction(async (tx) => {
      await tx.knowledgeDocumentVersion.create({
        data: {
          id: versionId,
          documentId,
          versionNo: nextVersionNo,
          storageKey,
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          checksum,
          uploadedBy,
        },
      });
      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          checksum,
          storageKey,
          originalFilename: file.originalFilename,
        },
      });
    });
  } catch (error) {
    await deleteKbFile(storageKey);
    throw error;
  }

  await audit({
    actorType: "USER",
    actorUserId: uploadedBy,
    actorLabel: uploadedByLabel,
    action: "kb.document.replaced",
    entityType: "KnowledgeDocument",
    entityId: documentId,
    metadata: {
      documentId,
      versionNo: nextVersionNo,
      filename: file.originalFilename,
      sizeBytes: file.buffer.length,
      mimeType: file.mimeType,
    },
  });

  return processDocument(documentId, { id: uploadedBy, label: uploadedByLabel });
}

// ------------------------------------------------------------------- delete

export async function deleteDocument(
  documentId: string,
  actor: KbActor
): Promise<void> {
  const document = await db.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      storageKey: true,
      originalFilename: true,
      versions: { select: { id: true, storageKey: true } },
    },
  });
  if (!document) {
    throw new KbInputError("سند یافت نشد.", 404);
  }

  // Chunks + versions cascade (schema onDelete: Cascade).
  await db.knowledgeDocument.delete({ where: { id: documentId } });

  // Best-effort storage cleanup (deleteKbFile never throws); the document's
  // active file plus every historical version file.
  const targets = new Set<string>([document.storageKey]);
  for (const version of document.versions) targets.add(version.storageKey);
  for (const key of targets) {
    await deleteKbFile(key);
  }

  await audit({
    actorType: "USER",
    actorUserId: actor.id,
    actorLabel: actor.label,
    action: "kb.document.deleted",
    entityType: "KnowledgeDocument",
    entityId: documentId,
    metadata: {
      documentId,
      filename: document.originalFilename,
    },
  });
}
