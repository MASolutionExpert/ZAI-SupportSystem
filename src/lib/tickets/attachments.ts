import "server-only";

import { randomBytes } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { sha256Hex } from "@/lib/crypto";
import { ensureStorageRoot, getStorageRoot } from "@/lib/storage";

/**
 * Ticket attachments (Phase 4) — upload security per master spec §10:
 * content-based MIME verification (magic bytes), extension allowlist,
 * randomized server-side identifiers, files OUTSIDE the web root and DB,
 * downloads only through authorized endpoints, path-traversal-safe reads.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

const TICKETS_SUBFOLDER = "tickets";

type AllowedType = {
  ext: string;
  mimeType: string;
  /** Content sniff: first bytes must match; undefined = structured check. */
  magic?: Array<[number, string]>;
  text?: boolean;
};

/**
 * Server-side allowlist — the declared client Content-Type is never trusted;
 * every file is sniffed and mapped to its verified type.
 */
const ALLOWED: AllowedType[] = [
  { ext: "pdf", mimeType: "application/pdf", magic: [[0, "%PDF-"]] },
  { ext: "png", mimeType: "image/png", magic: [[0, "\x89PNG\r\n\x1a\n"]] },
  { ext: "jpg", mimeType: "image/jpeg", magic: [[0, "\xff\xd8\xff"]] },
  { ext: "webp", mimeType: "image/webp", magic: [[0, "RIFF"], [8, "WEBP"]] },
  { ext: "zip", mimeType: "application/zip", magic: [[0, "PK\x03\x04"]] },
  { ext: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [[0, "PK\x03\x04"], [30, "[Content_Types].xml"]] },
  { ext: "txt", mimeType: "text/plain", text: true },
];

export type AttachmentCheckResult =
  | { ok: true; ext: string; mimeType: string; checksum: string; storageKey: string }
  | { ok: false; error: string };

function startsWithAt(buffer: Buffer, offset: number, s: string): boolean {
  if (buffer.length < offset + s.length) return false;
  return buffer.subarray(offset, offset + s.length).toString("latin1") === s;
}

/** Validate one attachment by CONTENT (not client-declared type). */
export async function prepareAttachment(
  filename: string,
  buffer: Buffer
): Promise<AttachmentCheckResult> {
  if (buffer.length === 0) {
    return { ok: false, error: "فایل خالی است." };
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "حجم فایل بیش از سقف ۱۰ مگابایت است." };
  }

  const dot = filename.lastIndexOf(".");
  const rawExt = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  if (!/^[a-z0-9]{1,10}$/.test(rawExt)) {
    return { ok: false, error: "پسوند فایل نامعتبر است." };
  }

  const candidate = ALLOWED.find((t) => t.ext === rawExt);
  if (!candidate) {
    return { ok: false, error: "نوع فایل مجاز نیست (فقط pdf، تصویر، txt، zip، docx)." };
  }

  let verified: AllowedType = candidate;
  if (candidate.text) {
    // Plain text: must decode as UTF-8 and contain no NUL bytes.
    if (buffer.includes(0) || buffer.toString("utf8").includes("\uFFFD")) {
      return { ok: false, error: "محتوای فایل با پسوند txt سازگار نیست." };
    }
  } else {
    const match = candidate.magic!.every(([offset, sig]) => startsWithAt(buffer, offset, sig));
    if (!match) {
      // Content does not match its extension — try other allowed types by
      // content so honest files (e.g., zip renamed to docx) still work.
      const byContent = ALLOWED.find(
        (t) => !t.text && t.magic!.every(([offset, sig]) => startsWithAt(buffer, offset, sig))
      );
      if (!byContent) {
        return { ok: false, error: "محتوای فایل با نوع اعلام‌شده سازگار نیست." };
      }
      verified = byContent;
    }
  }

  const checksum = sha256Hex(buffer);
  const storageKey = `${TICKETS_SUBFOLDER}/${Date.now().toString(36)}-${randomBytes(12).toString("hex")}.${verified.ext}`;
  return { ok: true, ext: verified.ext, mimeType: verified.mimeType, checksum, storageKey };
}

/** Persist validated attachment bytes (creates the folder on demand). */
export async function writeAttachmentFile(storageKey: string, buffer: Buffer): Promise<void> {
  const target = resolveInsideRoot(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
}

/** Read attachment bytes through the path-traversal guard. */
export async function readAttachmentFile(storageKey: string): Promise<Buffer> {
  const target = resolveInsideRoot(storageKey);
  return readFile(target);
}

/** Delete attachment bytes — best-effort (never throws). */
export async function deleteAttachmentFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveInsideRoot(storageKey));
  } catch {
    // ignore
  }
}

function resolveInsideRoot(storageKey: string): string {
  const root = path.resolve(getStorageRoot());
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("مسیر ذخیره‌سازی نامعتبر است.");
  }
  return resolved;
}

/** Ensure the tickets storage folder exists (used at boot/first upload). */
export async function ensureTicketsStorage(): Promise<void> {
  await ensureStorageRoot(TICKETS_SUBFOLDER);
}
