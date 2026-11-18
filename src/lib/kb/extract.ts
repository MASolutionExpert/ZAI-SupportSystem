/**
 * Knowledge Base — text extraction from uploaded documents.
 *
 * Contract: explicit failure, never silent partial success. Every failure
 * path returns `{ ok: false, error }` with a Persian message that is
 * displayed first-class on the document status (no thrown errors).
 *
 * pdf-parse v2 ships a class-based API (no `lib/pdf-parse.js` and no default
 * function export like v1). The module is imported through a runtime-computed
 * specifier so the bundler leaves it external — pdfjs-dist spawns worker
 * files and pulls a native canvas dependency that must not be inlined into
 * the Next.js server bundle.
 */

import { MIME_DOCX, MIME_PDF, MIME_TEXT_MARKDOWN, MIME_TEXT_PLAIN } from "./mime";
import { KB_ALLOWED_MIME } from "./types";

export type ExtractionResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** Minimal structural type of the pieces of pdf-parse v2 we rely on. */
type PdfParseParser = {
  getText: () => Promise<{ text: string }>;
  destroy: () => Promise<void>;
};

type PdfParseCtor = new (options: { data: Uint8Array }) => PdfParseParser;

/**
 * pdf-parse v2 ships both ESM and CJS builds (and v1 had a completely
 * different function API) — accept every observed module shape instead of
 * hard-coding one, and fail loudly when none matches.
 */
function resolvePdfParseCtor(mod: unknown): PdfParseCtor {
  const shapes = [
    ...(typeof mod === "object" && mod !== null
      ? [mod as { PDFParse?: PdfParseCtor; default?: { PDFParse?: PdfParseCtor } }]
      : []),
    ...((mod as { default?: unknown } | null)?.default &&
    typeof (mod as { default?: unknown }).default === "object"
      ? [((mod as { default?: unknown }).default ?? {}) as { PDFParse?: PdfParseCtor }]
      : []),
  ];
  for (const shape of shapes) {
    if (typeof shape.PDFParse === "function") return shape.PDFParse;
  }
  throw new Error("pdf-parse module does not expose PDFParse");
}

/** Minimal structural type of the pieces of mammoth we rely on. */
type MammothModule = {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

/** Ratio of letters (any script) in the decoded string. */
function letterRatio(text: string): number {
  if (text.length === 0) return 0;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters / text.length;
}

/** utf-8 decode of plain/markdown bytes with a binary-detector guard. */
function extractPlainText(buffer: Buffer): ExtractionResult {
  const decoded = buffer.toString("utf8");
  // <1% letters ⇒ binary payload mislabeled as text or an unsupported codec.
  if (letterRatio(decoded) < 0.01) {
    return {
      ok: false,
      error: "فایل متنی قابل استخراج نیست؛ کدگذاری فایل پشتیبانی نمی‌شود.",
    };
  }
  return { ok: true, text: decoded };
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  try {
    // Runtime-computed specifier: keeps pdf-parse (pdfjs worker + native
    // canvas) external to the server bundle. Resolved from node_modules.
    const moduleName = "pdf-parse";
    const mod: unknown = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleName);
    const PDFParse = resolvePdfParseCtor(mod);

    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const text = (result.text ?? "").trim();
      if (text.length < 20) {
        return {
          ok: false,
          error: "متن قابل استخراجی در این PDF یافت نشد (احتمالاً تصویری/اسکن‌شده است).",
        };
      }
      return { ok: true, text };
    } finally {
      // Always release the pdfjs document/worker.
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    return {
      ok: false,
      error: "استخراج متن از فایل PDF ناموفق بود؛ فایل ممکن است خراب یا رمز‌دار باشد.",
    };
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const mammoth = (await import("mammoth")) as unknown as MammothModule;
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value ?? "").trim();
    if (text.length < 20) {
      return {
        ok: false,
        error: "متن قابل استخراجی در این سند Word یافت نشد.",
      };
    }
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      error: "استخراج متن از سند Word ناموفق بود؛ فایل ممکن است خراب باشد.",
    };
  }
}

/** Extract raw text from document bytes according to its mime type. */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  switch (mimeType) {
    case MIME_TEXT_PLAIN:
    case MIME_TEXT_MARKDOWN:
      return extractPlainText(buffer);
    case MIME_PDF:
      return extractPdf(buffer);
    case MIME_DOCX:
      return extractDocx(buffer);
    default:
      return {
        ok: false,
        error: "قالب فایل برای استخراج متن پشتیبانی نمی‌شود.",
      };
  }
}

/** Type guard used by upload routes to validate the detected mime type. */
export function isAllowedKbMime(mimeType: string): mimeType is (typeof KB_ALLOWED_MIME)[number] {
  return (KB_ALLOWED_MIME as readonly string[]).includes(mimeType);
}
