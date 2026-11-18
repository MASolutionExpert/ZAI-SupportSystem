import { NextRequest } from "next/server";
import { apiOk, apiError, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai/usage?days=7 — aggregated AI usage report (AiUsageLog):
 * totals by outcome, per-department request counts, and the 25 most recent
 * calls. All windows are relative to the requested number of days (1..90).
 */

const DEFAULT_DAYS = 7;
const RECENT_LIMIT = 25;

export async function GET(req: NextRequest) {
  const guard = await requirePermission("ai.usage.view");
  if (!guard.ok) return guard.response;

  const rawDays = req.nextUrl.searchParams.get("days");
  let days = DEFAULT_DAYS;
  if (rawDays !== null) {
    const parsed = Number(rawDays);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
      return apiError("بازه روزها باید عددی بین ۱ تا ۹۰ باشد.", 422, "VALIDATION_ERROR");
    }
    days = parsed;
  }

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const window = { createdAt: { gte: since } };

    const [outcomeRows, sums, departmentRows, recentRows, seriesRows] = await Promise.all([
      db.aiUsageLog.groupBy({
        by: ["outcome"],
        _count: { _all: true },
        where: window,
      }),
      db.aiUsageLog.aggregate({
        _sum: { promptTokens: true, completionTokens: true },
        _avg: { latencyMs: true },
        where: window,
      }),
      db.aiUsageLog.groupBy({
        by: ["departmentId"],
        _count: { _all: true },
        where: { ...window, departmentId: { not: null } },
      }),
      db.aiUsageLog.findMany({
        where: window,
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          departmentId: true,
          provider: true,
          model: true,
          promptTokens: true,
          completionTokens: true,
          latencyMs: true,
          outcome: true,
          createdAt: true,
        },
      }),
      // Minimal columns for the daily series bucketing (Phase 6 reports UI).
      db.aiUsageLog.findMany({
        where: window,
        select: { createdAt: true, promptTokens: true, completionTokens: true },
      }),
    ]);

    // Totals by outcome.
    const countByOutcome = new Map<string, number>();
    let requests = 0;
    for (const row of outcomeRows) {
      const count = row._count._all;
      countByOutcome.set(row.outcome, count);
      requests += count;
    }

    const totals = {
      requests,
      answered: countByOutcome.get("ANSWERED") ?? 0,
      abstained: countByOutcome.get("ABSTAINED") ?? 0,
      handoff: countByOutcome.get("HANDOFF") ?? 0,
      errors: countByOutcome.get("ERROR") ?? 0,
      avgLatencyMs: Math.round(sums._avg.latencyMs ?? 0),
      promptTokens: sums._sum.promptTokens ?? 0,
      completionTokens: sums._sum.completionTokens ?? 0,
    };

    // Department names for both aggregations (null-safe — a department may
    // have been deleted after its usage was recorded).
    const departmentIds = [
      ...new Set(
        [
          ...departmentRows.map((row) => row.departmentId),
          ...recentRows.map((row) => row.departmentId),
        ].filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const departments = departmentIds.length
      ? await db.department.findMany({
          where: { id: { in: departmentIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(departments.map((d) => [d.id, d.name]));

    const byDepartment = departmentRows
      .map((row) => ({
        departmentId: row.departmentId,
        departmentName: row.departmentId ? nameById.get(row.departmentId) ?? null : null,
        requests: row._count._all,
      }))
      .filter((row): row is { departmentId: string; departmentName: string | null; requests: number } =>
        typeof row.departmentId === "string"
      )
      .sort((a, b) => b.requests - a.requests);

    const recent = recentRows.map((row) => ({
      id: row.id,
      departmentId: row.departmentId,
      departmentName: row.departmentId ? nameById.get(row.departmentId) ?? null : null,
      provider: row.provider,
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      latencyMs: row.latencyMs,
      outcome: row.outcome,
      createdAt: row.createdAt.toISOString(),
    }));

    // Daily series bucketed in the report timezone (Iran, no DST since 2022 —
    // fixed ±24h stepping is exact). Zero-filled over the whole window.
    const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" });
    const bucketKeys: string[] = [];
    const nowMs = Date.now();
    for (let i = days - 1; i >= 0; i -= 1) {
      bucketKeys.push(dayKeyFmt.format(new Date(nowMs - i * 24 * 60 * 60 * 1000)));
    }
    const seriesMap = new Map(
      bucketKeys.map((day) => [day, { day, requests: 0, promptTokens: 0, completionTokens: 0 }])
    );
    for (const row of seriesRows) {
      const key = dayKeyFmt.format(row.createdAt);
      const bucket = seriesMap.get(key);
      if (bucket) {
        bucket.requests += 1;
        bucket.promptTokens += row.promptTokens;
        bucket.completionTokens += row.completionTokens;
      }
    }
    const byDay = bucketKeys.map((day) => seriesMap.get(day)!);

    return apiOk({
      days,
      since: since.toISOString(),
      totals,
      byDay,
      byDepartment,
      recent,
    });
  } catch (error) {
    console.error("[api/admin/ai/usage] failed:", error);
    return apiError("دریافت گزارش مصرف هوش مصنوعی ناموفق بود.", 500, "USAGE_REPORT_FAILED");
  }
}
