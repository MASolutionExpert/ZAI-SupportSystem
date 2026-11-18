/**
 * RAG Engine — structure-aware document extraction.
 *
 * Produces ordered `StructureBlock`s (headings / paragraphs / tables with page
 * numbers when the format provides them) instead of a flat text blob, so the
 * chunker can build heading-path provenance and parent-child relations.
 *
 * Contracts kept from the legacy extractor: every failure path returns an
 * explicit Persian error (never silent partial success), and malformed /
 * binary payloads fail loudly.
 *
 * Formats:
 *  - PDF   → pdf-parse v2 per-page `getText()` (real page provenance)
 *  - DOCX  → mammoth `convertToHtml` (h1..h6/p/table preserved, unlike
 *            `extractRawText` which flattens headings)
 *  - XLSX  → SheetJS: one heading block per sheet + a table block per sheet
 *  - MD/TXT→ line-based ATX headings + paragraphs + pipe tables
 */

import { MIME_DOCX, MIME_PDF, MIME_TEXT_MARKDOWN, MIME_TEXT_PLAIN } from "@/lib/kb/mime";
import { MIME_XLSX } from "./mime-ext";

export type StructureBlock =
  | { type: "heading"; level: number; text: string; page: number | null }
  | { type: "paragraph"; text: string; page: number | null }
  | { type: "table"; text: string; page: number | null };

export type StructureResult =
  | { ok: true; blocks: StructureBlock[]; chars: number }
  | { ok: false; error: string };

/** Hard cap on extracted characters — protects memory from pathological files. */
const MAX_EXTRACTED_CHARS = 400_000;

// --------------------------------------------------------------- pdf-parse v2 --

type PdfParseParser = {
  getText: () => Promise<{ pages?: Array<{ num?: unknown; text?: unknown }>; text?: string }>;
  destroy: () => Promise<void>;
};

type PdfParseCtor = new (options: { data: Uint8Array }) => PdfParseCtor & PdfParseParser;

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

/** Split a page's raw text into paragraph-ish blocks on blank lines. */
function pageToBlocks(pageNum: number, rawPageText: string): StructureBlock[] {
  const blocks: StructureBlock[] = [];
  const normalized = rawPageText.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  for (const part of normalized.split(/\n\s*\n+/)) {
    const text = part.split("\n").map((l) => l.trim()).filter(Boolean).join("\n").trim();
    if (text.length < 3) continue;
    blocks.push({ type: "paragraph", text, page: pageNum });
  }
  return blocks;
}

async function extractPdfStructured(buffer: Buffer): Promise<StructureResult> {
  try {
    const moduleName = "pdf-parse";
    const mod: unknown = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleName);
    const PDFParse = resolvePdfParseCtor(mod);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const pages = Array.isArray(result.pages) ? result.pages : [];
      const blocks: StructureBlock[] = [];
      let chars = 0;

      if (pages.length > 0) {
        for (const page of pages) {
          const num = typeof page.num === "number" ? page.num : blocks.length + 1;
          const text = typeof page.text === "string" ? page.text : "";
          const pageBlocks = pageToBlocks(num, text);
          for (const block of pageBlocks) {
            chars += block.text.length;
            blocks.push(block);
          }
        }
      } else if (typeof result.text === "string") {
        // Older builds without the pages array — degrade to pageless blocks.
        for (const block of pageToBlocks(0, result.text)) {
          chars += block.text.length;
          blocks.push(block);
        }
      }

      if (chars < 20) {
        return {
          ok: false,
          error: "متن قابل استخراجی در این PDF یافت نشد (احتمالاً تصویری/اسکن‌شده است).",
        };
      }
      if (chars > MAX_EXTRACTED_CHARS) {
        blocks.length = 0;
        return { ok: false, error: "حجم متن سند بیش از حد مجاز برای فهرست‌سازی است." };
      }
      return { ok: true, blocks, chars };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch {
    return {
      ok: false,
      error: "استخراج متن از فایل PDF ناموفق بود؛ فایل ممکن است خراب یا رمز‌دار باشد.",
    };
  }
}

// -------------------------------------------------------------------- DOCX --

type MammothModule = {
  convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

/** Decode the handful of entities mammoth emits; everything else passes. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

const HTML_BLOCK_RE = /<(h[1-6]|p|table)[^>]*>([\s\S]*?)<\/\1>/gi;
const HTML_TAG_RE = /<[^>]+>/g;

function htmlToText(fragment: string): string {
  return decodeHtmlEntities(fragment.replace(/<br\s*\/?>/gi, "\n").replace(HTML_TAG_RE, ""))
    .replace(/[ \t]+/g, " ")
    .trim();
}

function htmlTableToText(fragment: string): string | null {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(fragment)) !== null) {
    const cells: string[] = [];
    const cellRe = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
      cells.push(htmlToText(cellMatch[2] ?? ""));
    }
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  if (rows.length === 0) return null;
  // Markdown pipe table — compact, LLM-friendly, chunkable.
  const width = Math.max(...rows.map((r) => r.length));
  const lines = rows.map((row) => {
    const padded = [...row];
    while (padded.length < width) padded.push("");
    return `| ${padded.join(" | ")} |`;
  });
  const text = [lines[0], `|${" --- |".repeat(width)}`, ...lines.slice(1)].join("\n");
  return text.length > 8000 ? text.slice(0, 8000) : text;
}

async function extractDocxStructured(buffer: Buffer): Promise<StructureResult> {
  try {
    const mammoth = (await import("mammoth")) as unknown as MammothModule;
    const result = await mammoth.convertToHtml({ buffer });
    const html = result.value ?? "";

    const blocks: StructureBlock[] = [];
    let chars = 0;
    let match: RegExpExecArray | null;
    HTML_BLOCK_RE.lastIndex = 0;

    while ((match = HTML_BLOCK_RE.exec(html)) !== null) {
      const tag = match[1]!.toLowerCase();
      const inner = match[2] ?? "";
      if (tag === "table") {
        const tableText = htmlTableToText(inner);
        if (tableText) {
          chars += tableText.length;
          blocks.push({ type: "table", text: tableText, page: null });
        }
        continue;
      }
      const text = htmlToText(inner);
      if (text.length < 2) continue;
      chars += text.length;
      if (tag.startsWith("h")) {
        blocks.push({ type: "heading", level: Number(tag.slice(1)), text, page: null });
      } else {
        blocks.push({ type: "paragraph", text, page: null });
      }
      if (chars > MAX_EXTRACTED_CHARS) {
        return { ok: false, error: "حجم متن سند بیش از حد مجاز برای فهرست‌سازی است." };
      }
    }

    if (chars < 20) {
      return { ok: false, error: "متن قابل استخراجی در این سند Word یافت نشد." };
    }
    return { ok: true, blocks, chars };
  } catch {
    return { ok: false, error: "استخراج متن از سند Word ناموفق بود؛ فایل ممکن است خراب باشد." };
  }
}

// -------------------------------------------------------------------- XLSX --

type SheetJsModule = {
  read: (data: Buffer, options?: unknown) => unknown;
  utils: {
    sheet_to_json: (sheet: unknown, options?: unknown) => unknown[];
  };
};

function extractXlsxStructured(buffer: Buffer): StructureResult {
  try {
    // Dynamic import: SheetJS is CJS and must stay external to the bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as SheetJsModule;
    const workbook = XLSX.read(buffer, { type: "buffer" }) as {
      SheetNames: string[];
      Sheets: Record<string, unknown>;
    };

    const blocks: StructureBlock[] = [];
    let chars = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      }) as unknown[];
      if (rows.length === 0) continue;

      blocks.push({ type: "heading", level: 1, text: sheetName, page: null });

      const width = Math.max(
        ...rows.slice(0, 200).map((r) => (Array.isArray(r) ? r.length : 0))
      );
      const lines: string[] = [];
      for (const row of rows.slice(0, 500)) {
        if (!Array.isArray(row)) continue;
        const cells = row.map((cell) => String(cell ?? "").trim());
        if (!cells.some((c) => c.length > 0)) continue;
        const padded = [...cells];
        while (padded.length < width) padded.push("");
        lines.push(`| ${padded.join(" | ")} |`);
        chars += lines[lines.length - 1]!.length;
      }
      if (lines.length > 0) {
        const table = [lines[0], `|${" --- |".repeat(width)}`, ...lines.slice(1)].join("\n");
        blocks.push({ type: "table", text: table.slice(0, 12000), page: null });
      }
    }

    if (chars < 5) {
      return { ok: false, error: "هیچ داده قابل استخراجی در این فایل Excel یافت نشد." };
    }
    return { ok: true, blocks, chars };
  } catch {
    return { ok: false, error: "استخراج داده از فایل Excel ناموفق بود؛ فایل ممکن است خراب باشد." };
  }
}

// ------------------------------------------------------------- TXT / Markdown --

function isAtxHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line);
}

function isPipeTableRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.includes("|", 1);
}

function extractTextStructured(buffer: Buffer, markdown: boolean): StructureResult {
  const decoded = buffer.toString("utf8");
  const letters = decoded.match(/\p{L}/gu)?.length ?? 0;
  if (decoded.length > 0 && letters / decoded.length < 0.01) {
    return {
      ok: false,
      error: "فایل متنی قابل استخراج نیست؛ کدگذاری فایل پشتیبانی نمی‌شود.",
    };
  }
  if (decoded.length > MAX_EXTRACTED_CHARS) {
    return { ok: false, error: "حجم متن سند بیش از حد مجاز برای فهرست‌سازی است." };
  }

  const blocks: StructureBlock[] = [];
  let chars = 0;

  const lines = decoded.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let table: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text.length < 2) return;
    chars += text.length;
    blocks.push({ type: "paragraph", text, page: null });
  };
  const flushTable = () => {
    if (table.length >= 2) {
      const text = table.join("\n");
      chars += text.length;
      blocks.push({ type: "table", text, page: null });
    }
    table = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (markdown && isAtxHeading(line)) {
      flushParagraph();
      flushTable();
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s+/, "").trim();
      chars += text.length;
      blocks.push({ type: "heading", level, text, page: null });
      continue;
    }
    if (isPipeTableRow(line)) {
      flushParagraph();
      table.push(line);
      continue;
    }
    if (!line) {
      flushParagraph();
      flushTable();
      continue;
    }
    if (table.length > 0) {
      flushTable();
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushTable();

  if (chars < 20) {
    return { ok: false, error: "هیچ بخش قابل فهرست‌سازی از سند استخراج نشد." };
  }
  return { ok: true, blocks, chars };
}

// ------------------------------------------------------------------- facade --

/** Extract a document into ordered structure blocks with provenance. */
export async function extractDocumentStructure(
  buffer: Buffer,
  mimeType: string
): Promise<StructureResult> {
  switch (mimeType) {
    case MIME_TEXT_PLAIN:
      return extractTextStructured(buffer, false);
    case MIME_TEXT_MARKDOWN:
      return extractTextStructured(buffer, true);
    case MIME_PDF:
      return await extractPdfStructured(buffer);
    case MIME_DOCX:
      return await extractDocxStructured(buffer);
    case MIME_XLSX:
      return extractXlsxStructured(buffer);
    default:
      return { ok: false, error: "قالب فایل برای استخراج متن پشتیبانی نمی‌شود." };
  }
}
