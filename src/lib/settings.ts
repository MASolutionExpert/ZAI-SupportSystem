import { db } from "@/lib/db";
import { cacheGet, cacheSet, cacheDelete } from "@/lib/cache";

/**
 * System settings — key/value JSON store backed by the SystemSetting table.
 * Used for organizational identity (org name/tagline) now and AI provider
 * configuration (encrypted) in Phase 3.
 *
 * Caching: L1 in-process snapshot (15 s) + shared L2 snapshot via the cache
 * layer (60 s) so multi-instance deployments converge quickly; explicit
 * invalidation on every write keeps same-instance reads exact.
 */

export const SETTING_KEYS = {
  ORG_NAME: "org.name",
  ORG_TAGLINE: "org.tagline",
  ORG_SUPPORT_INTRO: "org.supportIntro",
} as const;

const DEFAULTS: Record<string, unknown> = {
  [SETTING_KEYS.ORG_NAME]: "سامانه پشتیبانی سازمان",
  [SETTING_KEYS.ORG_TAGLINE]: "پاسخگویی سریع، دقیق و محرمانه",
  [SETTING_KEYS.ORG_SUPPORT_INTRO]:
    "یک دپارتمان را انتخاب کنید تا گفتگو را آغاز کنید؛ دستیار هوشمند یا اپراتورهای ما پاسخگوی شما هستند.",
};

const CACHE_TTL_MS = 15_000;
const SHARED_CACHE_KEY = "settings:all";
const SHARED_CACHE_TTL_MS = 60_000;

type SettingsCache = {
  data: Map<string, unknown>;
  loadedAt: number;
};

let cache: SettingsCache | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
  // Fire-and-forget: the shared snapshot is recomputed from the DB on next miss.
  void cacheDelete(SHARED_CACHE_KEY);
}

function mapToPlainObject(map: Map<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(map);
}

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  // Shared L2 snapshot (multi-instance deployments) before hitting the DB.
  const shared = await cacheGet<Record<string, unknown>>(SHARED_CACHE_KEY);
  if (shared) {
    const map = new Map<string, unknown>(Object.entries(shared));
    cache = { data: map, loadedAt: Date.now() };
    return map;
  }

  const rows = await db.systemSetting.findMany();
  const map = new Map<string, unknown>();
  for (const row of rows) {
    try {
      map.set(row.key, JSON.parse(row.value));
    } catch {
      map.set(row.key, row.value);
    }
  }
  cache = { data: map, loadedAt: Date.now() };
  void cacheSet(SHARED_CACHE_KEY, mapToPlainObject(map), SHARED_CACHE_TTL_MS);
  return map;
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const data = await loadAll();
  if (data.has(key)) return data.get(key) as T;
  return DEFAULTS[key] as T;
}

export async function setSetting(
  key: string,
  value: unknown,
  updatedBy?: string
): Promise<void> {
  await db.systemSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(value), updatedBy: updatedBy ?? null },
    create: { key, value: JSON.stringify(value), updatedBy: updatedBy ?? null },
  });
  invalidateSettingsCache();
}
