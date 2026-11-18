import { mkdir, stat, readdir, readFile, writeFile, unlink } from "fs/promises";
import path from "path";
import { getEnv } from "@/lib/env";

/**
 * Storage abstraction (v1: local persistent disk).
 *
 * Master spec section 8/10: uploaded files must live OUTSIDE the web root and
 * outside the database, reached only through authorized download endpoints.
 * The driver interface below is intentionally narrow so an S3-compatible
 * driver can replace the local driver without touching feature modules
 * (ARCHITECTURE.md §6).
 */

function resolveStorageRoot(): string {
  const dir = getEnv().STORAGE_DIR;
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

/** Ensure the storage root (and a subfolder) exists. */
export async function ensureStorageRoot(subfolder?: string): Promise<string> {
  const root = resolveStorageRoot();
  const target = subfolder ? path.join(root, subfolder) : root;
  await mkdir(target, { recursive: true });
  return target;
}

/** Storage root path (used by Phase-5 file modules and quota accounting). */
export function getStorageRoot(): string {
  return resolveStorageRoot();
}

/**
 * Resolve a storage key to an absolute path that MUST stay inside the storage
 * root — the single path-traversal guard for every byte-level operation
 * (spec §10). Throws on any attempt to escape the root.
 */
export function resolveInsideStorageRoot(storageKey: string): string {
  const root = path.resolve(resolveStorageRoot());
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("مسیر ذخیره‌سازی نامعتبر است.");
  }
  return resolved;
}

/** Total bytes used under the storage root (approximate, recursive). */
export async function getStorageUsageBytes(): Promise<number> {
  let total = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        try {
          const s = await stat(full);
          total += s.size;
        } catch {
          // ignore transient file disappearances
        }
      }
    }
  }
  await walk(resolveStorageRoot());
  return total;
}

// --------------------------------------------------------------------------
// Driver interface + local driver (Phase 5) — feature modules only see this
// interface; an S3-compatible driver can be swapped in later (ARCHITECTURE §6)
// without any caller changes.
// --------------------------------------------------------------------------

export interface StorageDriver {
  /** Persist bytes under a randomized server-side key. */
  put(key: string, data: Buffer): Promise<void>;
  /** Read bytes through the path-traversal guard. */
  get(key: string): Promise<Buffer>;
  /** Remove bytes — best-effort (idempotent, never throws). */
  delete(key: string): Promise<void>;
  /** Current size, or null when the object does not exist. */
  stat(key: string): Promise<{ sizeBytes: number } | null>;
}

class LocalStorageDriver implements StorageDriver {
  async put(key: string, data: Buffer): Promise<void> {
    const target = resolveInsideStorageRoot(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    const target = resolveInsideStorageRoot(key);
    return readFile(target);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(resolveInsideStorageRoot(key));
    } catch {
      // idempotent
    }
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const s = await stat(resolveInsideStorageRoot(key));
      return { sizeBytes: s.size };
    } catch {
      return null;
    }
  }
}

let driverInstance: StorageDriver | null = null;

/** Process-wide storage driver (local v1; S3-compatible path preserved). */
export function getStorageDriver(): StorageDriver {
  if (!driverInstance) driverInstance = new LocalStorageDriver();
  return driverInstance;
}
