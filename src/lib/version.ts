import { readFile } from "fs/promises";
import path from "path";

let cachedVersion: string | null = null;

/**
 * Resolve the application version:
 * 1. APP_VERSION env override (set by some deployment pipelines)
 * 2. VERSION file at the project root (source of truth in Git + Docker image)
 * 3. package.json version as a final fallback
 */
export async function getAppVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  if (process.env.APP_VERSION) {
    cachedVersion = process.env.APP_VERSION;
    return cachedVersion;
  }
  try {
    const raw = await readFile(path.join(process.cwd(), "VERSION"), "utf8");
    const v = raw.trim();
    if (v) {
      cachedVersion = v;
      return v;
    }
  } catch {
    // VERSION file not present — fall through
  }
  try {
    const pkg = await readFile(path.join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(pkg) as { version?: string };
    const v: string = parsed.version ?? "0.0.0";
    cachedVersion = v;
    return v;
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}
