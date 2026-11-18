/**
 * Knowledge Base — mime type constants and server-side detection.
 *
 * The client-provided `file.type` is never trusted alone: the allowlist is
 * checked against the extension as well, so a renamed `.pdf.exe` or a
 * spoofed content type cannot slip through.
 */

export const MIME_PDF = "application/pdf";
export const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIME_TEXT_PLAIN = "text/plain";
export const MIME_TEXT_MARKDOWN = "text/markdown";
export const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Extension → allowed mime mapping (lowercase, without leading dot). */
const EXT_TO_MIME: Record<string, string> = {
  pdf: MIME_PDF,
  docx: MIME_DOCX,
  txt: MIME_TEXT_PLAIN,
  md: MIME_TEXT_MARKDOWN,
  markdown: MIME_TEXT_MARKDOWN,
  xlsx: MIME_XLSX,
};

/** Lowercased extension of a filename (without dot), or "" when none. */
export function filenameExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

const ALLOWED_MIME_SET: ReadonlySet<string> = new Set(Object.values(EXT_TO_MIME));

/**
 * Server-side mime detection for a KB upload: accept the browser-reported
 * type only when it is on the allowlist, otherwise fall back to the file
 * extension. Returns null for anything not explicitly allowed.
 */
export function detectAllowedMime(
  filename: string,
  reportedType: string
): string | null {
  if (reportedType && ALLOWED_MIME_SET.has(reportedType)) {
    return reportedType;
  }
  const ext = filenameExtension(filename);
  return ext && EXT_TO_MIME[ext] ? EXT_TO_MIME[ext] : null;
}
