/**
 * Knowledge Base — shared domain types, status unions and Persian labels.
 *
 * SQLite has no native enums: every status is a plain string validated by
 * these TS unions (plus Zod schemas in kb/validators) at the application
 * layer. JSON payloads (keywords, retrieval sources) are stored as
 * JSON-serialized strings in String columns.
 */

// ------------------------------------------------------------------ documents

export const KB_DOCUMENT_STATUSES = [
  "UPLOADED",
  "PROCESSING",
  "INDEXED",
  "FAILED",
  "DISABLED",
] as const;

export type KbDocumentStatus = typeof KB_DOCUMENT_STATUSES[number];

export const KB_DOCUMENT_STATUS_LABELS: Record<KbDocumentStatus, string> = {
  UPLOADED: "بارگذاری‌شده",
  PROCESSING: "در حال پردازش",
  INDEXED: "فهرست‌شده",
  FAILED: "ناموفق",
  DISABLED: "غیرفعال",
};

// ---------------------------------------------------------------- collections

export const KB_COLLECTION_ACCESS = ["GLOBAL", "DEPARTMENT", "RESTRICTED"] as const;

export type KbCollectionAccess = typeof KB_COLLECTION_ACCESS[number];

export const KB_COLLECTION_ACCESS_LABELS: Record<KbCollectionAccess, string> = {
  GLOBAL: "سازمانی (همه دپارتمان‌ها)",
  DEPARTMENT: "دپارتمانی",
  RESTRICTED: "محدود (مدیریتی)",
};

// ----------------------------------------------------------------------- Q&A

export const KB_QA_STATUSES = ["DRAFT", "PUBLISHED", "DISABLED"] as const;

export type KbQaStatus = typeof KB_QA_STATUSES[number];

export const KB_QA_STATUS_LABELS: Record<KbQaStatus, string> = {
  DRAFT: "پیش‌نویس",
  PUBLISHED: "منتشرشده",
  DISABLED: "غیرفعال",
};

// -------------------------------------------------------------- upload limits

export const KB_ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type KbAllowedMime = typeof KB_ALLOWED_MIME[number];

/** Hard upload cap per document file (15 MB). */
export const KB_MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

// ----------------------------------------------------------------- retrieval

export type RetrievalSourceRef = {
  kind: "QA" | "CHUNK";
  refId: string;
  title: string;
  score: number;
};

export type RetrievalResult = {
  /** ANSWERED when best source passes the threshold; otherwise abstained. */
  decision: "ANSWERED" | "ABSTAINED_NO_EVIDENCE" | "ABSTAINED_LOW_SCORE";
  /** 0..1 best source score */
  confidence: number;
  /** applied threshold for this call */
  threshold: number;
  /** top-k source references (audit + debugging) */
  sources: RetrievalSourceRef[];
  /** authoritative Q&A context for the answering step */
  qaContext: { id: string; question: string; officialAnswer: string }[];
  /** document chunk context (grounding text) */
  chunkContext: { id: string; documentTitle: string; text: string }[];
};
