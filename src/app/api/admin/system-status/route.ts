import { db } from "@/lib/db";
import { apiOk, requirePermission } from "@/lib/api";
import { countActiveSessions } from "@/lib/auth/session";
import { getAppVersion } from "@/lib/version";
import { checkDatabase } from "@/lib/db";
import { getStorageUsageBytes } from "@/lib/storage";
import { getEnv } from "@/lib/env";

/**
 * Real system status for the admin dashboard and the system-health page.
 * Guarded by deny-by-default RBAC: requires `admin.dashboard.view`.
 * Phase 6 added additive runtime/operational fields (runtime, extended
 * entity counts, env flags) — all values are measured live.
 */

const processStartedAt = Date.now();

export async function GET() {
  const guard = await requirePermission("admin.dashboard.view");
  if (!guard.ok) return guard.response;

  const dbStart = Date.now();
  const [version, databaseOk, activeSessions, users, departments, storageBytes] =
    await Promise.all([
      getAppVersion(),
      checkDatabase(),
      countActiveSessions().catch(() => -1),
      db.user.count().catch(() => -1),
      db.department.count().catch(() => -1),
      getStorageUsageBytes().catch(() => -1),
    ]);
  const dbLatencyMs = Date.now() - dbStart;

  const [
    ticketsOpen,
    ticketsInProgress,
    ticketsWaitingCustomer,
    ticketsResolved,
    conversationsActive,
    kbDocuments,
    sharedFiles,
    auditRows,
  ] = await Promise.all([
    db.ticket.count({ where: { status: "OPEN" } }).catch(() => -1),
    db.ticket.count({ where: { status: "IN_PROGRESS" } }).catch(() => -1),
    db.ticket.count({ where: { status: "WAITING_CUSTOMER" } }).catch(() => -1),
    db.ticket.count({ where: { status: "RESOLVED" } }).catch(() => -1),
    db.conversation
      .count({ where: { mode: { not: "RESOLVED" } } })
      .catch(() => -1),
    db.knowledgeDocument.count().catch(() => -1),
    db.sharedFile.count().catch(() => -1),
    db.auditLog.count().catch(() => -1),
  ]);

  const memory = process.memoryUsage();
  let envValid = true;
  let env: {
    appUrlSet: boolean;
    forceSecureCookies: boolean;
    bootstrapOnStartup: boolean;
    sessionTtlHours: number;
    loginMaxAttempts: number;
    loginLockMinutes: number;
  } = {
    appUrlSet: false,
    forceSecureCookies: false,
    bootstrapOnStartup: true,
    sessionTtlHours: 168,
    loginMaxAttempts: 5,
    loginLockMinutes: 15,
  };
  try {
    const parsed = getEnv();
    envValid = true;
    env = {
      appUrlSet: Boolean(parsed.APP_URL),
      forceSecureCookies: parsed.FORCE_SECURE_COOKIES === "true",
      bootstrapOnStartup: parsed.BOOTSTRAP_ON_STARTUP === "true",
      sessionTtlHours: parsed.SESSION_TTL_HOURS,
      loginMaxAttempts: parsed.LOGIN_MAX_ATTEMPTS,
      loginLockMinutes: parsed.LOGIN_LOCK_MINUTES,
    };
  } catch {
    envValid = false;
  }

  return apiOk({
    version,
    uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
    database: { ok: databaseOk, latencyMs: dbLatencyMs },
    counts: {
      users,
      departments,
      activeSessions,
      ticketsOpen,
      ticketsInProgress,
      ticketsWaitingCustomer,
      ticketsResolved,
      conversationsActive,
      kbDocuments,
      sharedFiles,
      auditRows,
    },
    storage: { usedBytes: storageBytes },
    runtime: {
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      pid: process.pid,
    },
    env: { valid: envValid, ...env },
    generatedAt: new Date().toISOString(),
  });
}
