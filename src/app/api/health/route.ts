import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db";
import { getAppVersion } from "@/lib/version";

/**
 * Public health endpoint — used by Docker healthchecks, the supportdesk CLI
 * and uptime monitors. Exposes no configuration or secrets.
 */

const startedAt = Date.now();

export async function GET() {
  const databaseOk = await checkDatabase();
  const version = await getAppVersion();

  const body = {
    status: databaseOk ? "ok" : "degraded",
    checks: { database: databaseOk },
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: databaseOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
