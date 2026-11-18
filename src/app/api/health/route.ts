import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db";
import { getCacheStatus } from "@/lib/cache";
import { getAppVersion } from "@/lib/version";

/**
 * Public health endpoint — used by Docker healthchecks, the supportdesk CLI
 * and uptime monitors. Exposes no configuration or secrets. `checks.cache`
 * reports the effective shared-tier backend ("redis" | "memory") — a Redis
 * outage degrades the cache tier only and does NOT fail the health check
 * (the app is fully functional on the in-process fallback).
 */

const startedAt = Date.now();

export async function GET() {
  const databaseOk = await checkDatabase();
  const version = await getAppVersion();
  const cache = getCacheStatus();

  const body = {
    status: databaseOk ? "ok" : "degraded",
    checks: { database: databaseOk, cache: cache.backend },
    cache: { backend: cache.backend, redisStatus: cache.redisStatus },
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: databaseOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
