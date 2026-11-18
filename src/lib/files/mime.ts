import "server-only";

/**
 * Content-based file type verification for the shared file hub (spec §10).
 * The client-declared Content-Type and extension are never trusted: every
 * upload is sniffed by magic bytes (or UTF-8 text rules) and mapped to its
 * verified type. The allowlist configured in storage settings can only ever
 * RESTRICT this set — it can never admit a type we cannot verify.
 */

export type VerifiableType = {
  ext: string;
  mimeType: string;
  /** Content sniff: first bytes must match at each offset; undefined = text. */
  magic?: Array<[number, string]>;
  text?: boolean;
};

/** Content-verifiable universe (PDF/images/zip-based/text). */
export const SUPPORTED_TYPES: VerifiableType[] = [
  { ext: "pdf", mimeType: "application/pdf", magic: [[0, "%PDF-"]] },
  { ext: "png", mimeType: "image/png", magic: [[0, "\x89PNG\r\n\x1a\n"]] },
  { ext: "jpg", mimeType: "image/jpeg", magic: [[0, "\xff\xd8\xff"]] },
  { ext: "webp", mimeType: "image/webp", magic: [[0, "RIFF"], [8, "WEBP"]] },
  { ext: "zip", mimeType: "application/zip", magic: [[0, "PK\x03\x04"]] },
  {
    ext: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: [[0, "PK\x03\x04"], [30, "[Content_Types].xml"]],
  },
  { ext: "txt", mimeType: "text/plain", text: true },
  { ext: "csv", mimeType: "text/plain", text: true },
];

/** Persian-friendly list of the supported formats for error messages. */
export const SUPPORTED_TYPES_LABEL = "PDF، تصویر (png/jpg/webp)، zip، docx، txt، csv";

function startsWithAt(buffer: Buffer, offset: number, s: string): boolean {
  if (buffer.length < offset + s.length) return false;
  return buffer.subarray(offset, offset + s.length).toString("latin1") === s;
}

export type MimeCheckResult =
  | { ok: true; ext: string; mimeType: string }
  | { ok: false; error: string };

/**
 * Verify `buffer` against `filename`'s extension and the effective allowlist
 * (settings-level restriction). Returns the verified type — never the
 * client-declared one.
 */
export function verifyContentType(
  filename: string,
  buffer: Buffer,
  allowedExtensions: string[]
): MimeCheckResult {
  if (buffer.length === 0) {
    return { ok: false, error: "فایل خالی است." };
  }

  const dot = filename.lastIndexOf(".");
  const rawExt = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  if (!/^[a-z0-9]{1,10}$/.test(rawExt)) {
    return { ok: false, error: "پسوند فایل نامعتبر است." };
  }

  const allow = new Set(allowedExtensions.map((e) => e.toLowerCase()));
  if (!allow.has(rawExt) || !SUPPORTED_TYPES.some((t) => t.ext === rawExt)) {
    return {
      ok: false,
      error: `نوع فایل مجاز نیست؛ فرمت‌های مجاز: ${SUPPORTED_TYPES_LABEL}.`,
    };
  }

  const candidate = SUPPORTED_TYPES.find((t) => t.ext === rawExt)!;

  let verified: VerifiableType = candidate;
  if (candidate.text) {
    // Plain text: must decode as UTF-8 and contain no NUL bytes.
    if (buffer.includes(0) || buffer.toString("utf8").includes("\uFFFD")) {
      return { ok: false, error: "محتوای فایل با پسوند اعلام‌شده سازگار نیست." };
    }
  } else {
    const match = candidate.magic!.every(([offset, sig]) =>
      startsWithAt(buffer, offset, sig)
    );
    if (!match) {
      // Content does not match its extension — try other allowed types by
      // content so honestly-typed files (e.g., zip renamed to docx) still
      // upload, while disguised binaries (exe → pdf) fail closed.
      const allowListed = new Set(allowedExtensions.map((e) => e.toLowerCase()));
      const byContent = SUPPORTED_TYPES.find(
        (t) =>
          !t.text &&
          allowListed.has(t.ext) &&
          t.magic!.every(([offset, sig]) => startsWithAt(buffer, offset, sig))
      );
      if (!byContent) {
        return { ok: false, error: "محتوای فایل با نوع اعلام‌شده سازگار نیست." };
      }
      verified = byContent;
    }
  }

  return { ok: true, ext: verified.ext, mimeType: verified.mimeType };
}

/** Extract a safe extension for a randomized storage key (verified type). */
export function storageKeyExtension(ext: string): string {
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : "bin";
}
