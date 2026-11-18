/**
 * Knowledge Base — file storage behind the storage abstraction.
 *
 * Files live under `<STORAGE_DIR>/kb/<versionId>.<ext>` (outside the web
 * root), reached only through these helpers. Every path crossing this module
 * is resolved against the storage root and asserted to stay inside it
 * (path-traversal guard), so a malicious `relativePath` can never escape.
 */

import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { ensureStorageRoot, getStorageRoot } from "@/lib/storage";
import {
  MIME_DOCX,
  MIME_PDF,
  MIME_TEXT_MARKDOWN,
  MIME_TEXT_PLAIN,
} from "./mime";

const KB_SUBFOLDER = "kb";

/** mime → canonical extension (server-side allowlist drives the mapping). */
const MIME_TO_EXT: Record<string, string> = {
  [MIME_PDF]: "pdf",
  [MIME_DOCX]: "docx",
  [MIME_TEXT_PLAIN]: "txt",
  [MIME_TEXT_MARKDOWN]: "md",
};

/**
 * Validate a candidate extension: `.` + 1-10 lowercase alphanumerics only.
 * Anything else (or no extension) maps to "".
 */
function safeExt(filename: string, mimeType?: string): string {
  if (mimeType && MIME_TO_EXT[mimeType]) {
    return `.${MIME_TO_EXT[mimeType]}`;
  }
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,10}$/.test(ext) ? `.${ext}` : "";
}

/**
 * Deterministic relative storage path for a KB file:
 * `kb/<id>.<safe-extension>`.
 */
export function kbStorageRelativePath(
  filename: string,
  id: string,
  mimeType?: string
): string {
  const ext = safeExt(filename, mimeType);
  return `${KB_SUBFOLDER}/${id}${ext}`;
}

/**
 * Resolve a relative KB path against the storage root and assert the result
 * stays inside it. Throws (Persian message) on any traversal attempt.
 */
function assertInsideRoot(relativePath: string): string {
  const root = path.resolve(getStorageRoot());
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("مسیر ذخیره‌سازی نامعتبر است.");
  }
  return resolved;
}

/** Persist a KB file (creates the `kb/` folder on demand). */
export async function writeKbFile(buffer: Buffer, relativePath: string): Promise<void> {
  const target = assertInsideRoot(relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
}

/** Read a KB file; throws a Persian error when the file is missing. */
export async function readKbFile(relativePath: string): Promise<Buffer> {
  const target = assertInsideRoot(relativePath);
  try {
    return await readFile(target);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      throw new Error("فایل سند در مخزن ذخیره‌سازی یافت نشد.");
    }
    throw error;
  }
}

/** Delete a KB file — best-effort, never throws. */
export async function deleteKbFile(relativePath: string): Promise<void> {
  try {
    const target = assertInsideRoot(relativePath);
    await unlink(target);
  } catch {
    // Best-effort cleanup: missing files or transient IO errors are ignored.
  }
}

/** Existence check without reading bytes (used by the document detail API). */
export async function kbFileExists(relativePath: string): Promise<boolean> {
  try {
    const target = assertInsideRoot(relativePath);
    const info = await stat(target);
    return info.isFile();
  } catch {
    return false;
  }
}
