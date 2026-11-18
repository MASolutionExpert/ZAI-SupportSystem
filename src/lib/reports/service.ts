import { db } from "@/lib/db";

/**
 * Management reports (Phase 6) — ticket, operator-activity and assignment
 * aggregations over a rolling time window. All functions are read-only;
 * every value is derived from real rows (no sampling, no placeholders).
 *
 * Day buckets use the Asia/Tehran calendar day (Iran has no DST since 2022,
 * so fixed ±24h stepping is exact). ISO date keys (YYYY-MM-DD) are returned
 * and rendered with the Jalali formatter on the client.
 */

const REPORT_TIMEZONE = "Asia/Tehran";

export const REPORT_DAY_LIMITS = { min: 1, max: 90 } as const;

const ACTIVE_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] as const;
const ASSIGNMENT_MODE_KEYS = ["AUTO_FAIR", "MANUAL", "TRANSFER", "SELF"] as const;

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** ISO date key (YYYY-MM-DD) of a timestamp in the report timezone. */
function dayKey(date: Date): string {
  // en-CA yields ISO YYYY-MM-DD deterministically.
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE }).format(date);
}

/** Consecutive daily buckets ending with today (oldest first). */
function emptyDayBuckets(days: number): string[] {
  const buckets: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.push(dayKey(new Date(now - i * 24 * 60 * 60 * 1000)));
  }
  return buckets;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

// ------------------------------------------------------------- tickets ----

export type TicketReport = {
  days: number;
  since: string;
  departmentId: string | null;
  totals: {
    created: number;
    resolvedInWindow: number;
    resolutionRatePct: number;
    avgFirstResponseMs: number | null;
    medianFirstResponseMs: number | null;
    avgResolutionMs: number | null;
    medianResolutionMs: number | null;
  };
  backlog: Array<{ status: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byCreatedVia: Array<{ via: string; count: number }>;
  byDepartment: Array<{ departmentId: string; departmentName: string; count: number }>;
  createdPerDay: Array<{ day: string; count: number }>;
  resolvedPerDay: Array<{ day: string; count: number }>;
};

export async function getTicketReport(input: {
  days: number;
  departmentId?: string | null;
}): Promise<TicketReport> {
  const days = Math.min(Math.max(input.days, REPORT_DAY_LIMITS.min), REPORT_DAY_LIMITS.max);
  const since = sinceDate(days);
  const departmentId = input.departmentId ?? null;
  const scopeWhere = departmentId ? { departmentId } : {};

  const [
    createdCount,
    resolvedCount,
    statusRows,
    viaRows,
    departmentRows,
    firstResponseRows,
    resolvedDurations,
    backlogRows,
  ] = await Promise.all([
    db.ticket.count({ where: { createdAt: { gte: since }, ...scopeWhere } }),
    db.ticket.count({ where: { resolvedAt: { gte: since }, ...scopeWhere } }),
    db.ticket.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { createdAt: { gte: since }, ...scopeWhere },
    }),
    db.ticket.groupBy({
      by: ["createdVia"],
      _count: { _all: true },
      where: { createdAt: { gte: since }, ...scopeWhere },
    }),
    db.ticket.groupBy({
      by: ["departmentId"],
      _count: { _all: true },
      where: { createdAt: { gte: since } },
    }),
    db.ticket.findMany({
      where: { createdAt: { gte: since }, firstResponseAt: { not: null }, ...scopeWhere },
      select: { createdAt: true, firstResponseAt: true },
    }),
    db.ticket.findMany({
      where: { resolvedAt: { gte: since }, ...scopeWhere },
      select: { createdAt: true, resolvedAt: true },
    }),
    db.ticket.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { status: { in: [...ACTIVE_STATUSES] }, ...scopeWhere },
    }),
  ]);

  // Resolve department names for the cross-department breakdown.
  const departmentIds = departmentRows
    .map((r) => r.departmentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const departments = departmentIds.length
    ? await db.department.findMany({
        where: { id: { in: departmentIds } },
        select: { id: true, name: true },
      })
    : [];
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  // First-response and resolution durations (ms).
  const firstResponseDurations = firstResponseRows
    .filter((r): r is { createdAt: Date; firstResponseAt: Date } => r.firstResponseAt !== null)
    .map((r) => r.firstResponseAt.getTime() - r.createdAt.getTime())
    .filter((ms) => ms >= 0);
  const resolutionDurations = resolvedDurations
    .map((r) => (r.resolvedAt ? r.resolvedAt.getTime() - r.createdAt.getTime() : -1))
    .filter((ms) => ms >= 0);

  // Zero-filled daily series bucketed in the report timezone.
  const buckets = emptyDayBuckets(days);
  const createdMap = new Map<string, number>(buckets.map((day) => [day, 0]));
  const createdRows = await db.ticket.findMany({
    where: { createdAt: { gte: since }, ...scopeWhere },
    select: { createdAt: true },
  });
  for (const row of createdRows) {
    const key = dayKey(row.createdAt);
    if (createdMap.has(key)) createdMap.set(key, (createdMap.get(key) ?? 0) + 1);
  }
  const resolvedMap = new Map<string, number>(buckets.map((day) => [day, 0]));
  for (const row of resolvedDurations) {
    if (!row.resolvedAt) continue;
    const key = dayKey(row.resolvedAt);
    if (resolvedMap.has(key)) resolvedMap.set(key, (resolvedMap.get(key) ?? 0) + 1);
  }

  return {
    days,
    since: since.toISOString(),
    departmentId,
    totals: {
      created: createdCount,
      resolvedInWindow: resolvedCount,
      resolutionRatePct:
        createdCount > 0 ? Math.round((resolvedCount / createdCount) * 100) : 0,
      avgFirstResponseMs: average(firstResponseDurations),
      medianFirstResponseMs: median(firstResponseDurations),
      avgResolutionMs: average(resolutionDurations),
      medianResolutionMs: median(resolutionDurations),
    },
    backlog: backlogRows.map((r) => ({ status: r.status, count: r._count._all })),
    byStatus: statusRows.map((r) => ({ status: r.status, count: r._count._all })),
    byCreatedVia: viaRows.map((r) => ({ via: r.createdVia, count: r._count._all })),
    byDepartment: departmentRows
      .filter((r): r is (typeof departmentRows)[number] & { departmentId: string } =>
        typeof r.departmentId === "string"
      )
      .map((r) => ({
        departmentId: r.departmentId,
        departmentName: departmentNameById.get(r.departmentId) ?? r.departmentId,
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    createdPerDay: buckets.map((day) => ({ day, count: createdMap.get(day) ?? 0 })),
    resolvedPerDay: buckets.map((day) => ({ day, count: resolvedMap.get(day) ?? 0 })),
  };
}

// ---------------------------------------------------- operator activity ----

export type OperatorActivityReport = {
  days: number;
  since: string;
  operators: Array<{
    id: string;
    name: string;
    username: string;
    roleName: string;
    status: string;
    isAvailable: boolean;
    assignedInWindow: number;
    resolvedInWindow: number;
    repliesInWindow: number;
    notesInWindow: number;
    openNow: number;
    lastReplyAt: string | null;
  }>;
};

export async function getOperatorActivityReport(input: {
  days: number;
}): Promise<OperatorActivityReport> {
  const days = Math.min(Math.max(input.days, REPORT_DAY_LIMITS.min), REPORT_DAY_LIMITS.max);
  const since = sinceDate(days);

  const [
    staff,
    roles,
    assignedRows,
    resolvedRows,
    replyRows,
    noteRows,
    openRows,
    lastReplyRows,
  ] = await Promise.all([
    db.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        roleKey: true,
        status: true,
        isAvailable: true,
      },
    }),
    db.role.findMany({ select: { key: true, name: true } }),
    db.ticket.groupBy({
      by: ["assignedToId"],
      _count: { _all: true },
      where: { assignedAt: { gte: since } },
    }),
    db.ticket.groupBy({
      by: ["assignedToId"],
      _count: { _all: true },
      where: { resolvedAt: { gte: since }, assignedToId: { not: null } },
    }),
    db.ticketMessage.groupBy({
      by: ["authorId"],
      _count: { _all: true },
      where: {
        authorType: "OPERATOR",
        isInternalNote: false,
        createdAt: { gte: since },
        authorId: { not: null },
      },
    }),
    db.ticketMessage.groupBy({
      by: ["authorId"],
      _count: { _all: true },
      where: {
        authorType: "OPERATOR",
        isInternalNote: true,
        createdAt: { gte: since },
        authorId: { not: null },
      },
    }),
    db.ticket.groupBy({
      by: ["assignedToId"],
      _count: { _all: true },
      where: { status: { in: [...ACTIVE_STATUSES] }, assignedToId: { not: null } },
    }),
    db.ticketMessage.groupBy({
      by: ["authorId"],
      _max: { createdAt: true },
      where: { authorType: "OPERATOR", authorId: { not: null } },
    }),
  ]);

  const roleNameByKey = new Map(roles.map((r) => [r.key, r.name]));

  const idCount = (rows: Array<{ key: string | null; count: number }>) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.key) map.set(row.key, row.count);
    }
    return map;
  };

  const mapAssigned = idCount(
    assignedRows.map((r) => ({ key: r.assignedToId, count: r._count._all }))
  );
  const mapResolved = idCount(
    resolvedRows.map((r) => ({ key: r.assignedToId, count: r._count._all }))
  );
  const mapOpen = idCount(
    openRows.map((r) => ({ key: r.assignedToId, count: r._count._all }))
  );
  const mapReplies = idCount(replyRows.map((r) => ({ key: r.authorId, count: r._count._all })));
  const mapNotes = idCount(noteRows.map((r) => ({ key: r.authorId, count: r._count._all })));
  const mapLastReply = new Map<string, Date>(
    lastReplyRows
      .filter((r): r is typeof r & { authorId: string } => r.authorId !== null)
      .map((r) => [r.authorId, r._max.createdAt])
      .filter((pair): pair is [string, Date] => Array.isArray(pair) && pair[1] !== null)
  );

  const operators = staff
    .map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      roleName: roleNameByKey.get(u.roleKey) ?? u.roleKey,
      status: u.status,
      isAvailable: u.isAvailable,
      assignedInWindow: mapAssigned.get(u.id) ?? 0,
      resolvedInWindow: mapResolved.get(u.id) ?? 0,
      repliesInWindow: mapReplies.get(u.id) ?? 0,
      notesInWindow: mapNotes.get(u.id) ?? 0,
      openNow: mapOpen.get(u.id) ?? 0,
      lastReplyAt: mapLastReply.get(u.id)?.toISOString() ?? null,
    }))
    // Activity-first ordering: busiest workload on top, then by name.
    .sort(
      (a, b) =>
        b.assignedInWindow + b.repliesInWindow - (a.assignedInWindow + a.repliesInWindow) ||
        a.name.localeCompare(b.name, "fa")
    );

  return { days, since: since.toISOString(), operators };
}

// ------------------------------------------------------------ assignments ----

export type AssignmentReport = {
  days: number;
  since: string;
  departmentId: string | null;
  totals: {
    created: number;
    assigned: number;
    unassigned: number;
    avgAssignDelayMs: number | null;
    medianAssignDelayMs: number | null;
  };
  byMode: Array<{ mode: string; count: number }>;
  byOperator: Array<{
    id: string;
    name: string;
    username: string;
    assignedInWindow: number;
    autoFair: number;
    manual: number;
    transfer: number;
    self: number;
    openNow: number;
  }>;
};

export async function getAssignmentReport(input: {
  days: number;
  departmentId?: string | null;
}): Promise<AssignmentReport> {
  const days = Math.min(Math.max(input.days, REPORT_DAY_LIMITS.min), REPORT_DAY_LIMITS.max);
  const since = sinceDate(days);
  const departmentId = input.departmentId ?? null;
  const scopeWhere = departmentId ? { departmentId } : {};

  const [
    createdCount,
    assignedCount,
    modeRows,
    operatorModeRows,
    delayRows,
    openRows,
    staff,
  ] = await Promise.all([
    db.ticket.count({ where: { createdAt: { gte: since }, ...scopeWhere } }),
    db.ticket.count({
      where: { createdAt: { gte: since }, assignedAt: { not: null }, ...scopeWhere },
    }),
    db.ticket.groupBy({
      by: ["assignmentMode"],
      _count: { _all: true },
      where: { createdAt: { gte: since }, ...scopeWhere },
    }),
    db.ticket.groupBy({
      by: ["assignedToId", "assignmentMode"],
      _count: { _all: true },
      where: { createdAt: { gte: since }, assignedToId: { not: null }, ...scopeWhere },
    }),
    db.ticket.findMany({
      where: { createdAt: { gte: since }, assignedAt: { not: null }, ...scopeWhere },
      select: { createdAt: true, assignedAt: true },
    }),
    db.ticket.groupBy({
      by: ["assignedToId"],
      _count: { _all: true },
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        assignedToId: { not: null },
        ...scopeWhere,
      },
    }),
    db.user.findMany({
      select: { id: true, name: true, username: true },
    }),
  ]);

  const delays = delayRows
    .filter((r): r is { createdAt: Date; assignedAt: Date } => r.assignedAt !== null)
    .map((r) => r.assignedAt.getTime() - r.createdAt.getTime())
    .filter((ms) => ms >= 0);

  const modeCount = (mode: string) =>
    modeRows
      .filter((r) => r.assignmentMode === mode)
      .reduce((sum, r) => sum + r._count._all, 0);

  const staffById = new Map(staff.map((u) => [u.id, u]));
  const openByOperator = new Map<string, number>(
    openRows
      .filter(
        (r): r is (typeof openRows)[number] & { assignedToId: string } =>
          typeof r.assignedToId === "string"
      )
      .map((r) => [r.assignedToId, r._count._all])
  );

  // Aggregate per-operator mode splits.
  const perOperator = new Map<
    string,
    { autoFair: number; manual: number; transfer: number; self: number; total: number }
  >();
  for (const row of operatorModeRows) {
    if (typeof row.assignedToId !== "string") continue;
    const entry =
      perOperator.get(row.assignedToId) ?? { autoFair: 0, manual: 0, transfer: 0, self: 0, total: 0 };
    const count = row._count._all;
    entry.total += count;
    switch (row.assignmentMode) {
      case "AUTO_FAIR":
        entry.autoFair += count;
        break;
      case "MANUAL":
        entry.manual += count;
        break;
      case "TRANSFER":
        entry.transfer += count;
        break;
      case "SELF":
        entry.self += count;
        break;
      default:
        break;
    }
    perOperator.set(row.assignedToId, entry);
  }

  const byOperator = [...perOperator.entries()]
    .map(([id, entry]) => {
      const user = staffById.get(id);
      return {
        id,
        name: user?.name ?? id,
        username: user?.username ?? "—",
        assignedInWindow: entry.total,
        autoFair: entry.autoFair,
        manual: entry.manual,
        transfer: entry.transfer,
        self: entry.self,
        openNow: openByOperator.get(id) ?? 0,
      };
    })
    .sort(
      (a, b) => b.assignedInWindow - a.assignedInWindow || a.name.localeCompare(b.name, "fa")
    );

  return {
    days,
    since: since.toISOString(),
    departmentId,
    totals: {
      created: createdCount,
      assigned: assignedCount,
      unassigned: createdCount - assignedCount,
      avgAssignDelayMs: average(delays),
      medianAssignDelayMs: median(delays),
    },
    byMode: ASSIGNMENT_MODE_KEYS.map((mode) => ({ mode, count: modeCount(mode) })),
    byOperator,
  };
}

// ------------------------------------------------------------ CSV export ----

const CSV_HEADERS = [
  "شماره تیکت",
  "موضوع",
  "دپارتمان",
  "وضعیت",
  "نحوه ایجاد",
  "اپراتور",
  "زمان ایجاد",
  "اولین پاسخ",
  "زمان حل",
] as const;

function csvEscape(value: string): string {
  // Neutralize formula-injection leading characters and quote fields safely.
  const sanitized = value.replace(/^([=+\-@])/, "'$1");
  return `"${sanitized.replace(/"/g, '""')}"`;
}

export async function buildTicketCsv(input: {
  days: number;
  departmentId?: string | null;
  status?: string | null;
}): Promise<{ filename: string; body: string }> {
  const days = Math.min(Math.max(input.days, REPORT_DAY_LIMITS.min), REPORT_DAY_LIMITS.max);
  const since = sinceDate(days);
  const departmentId = input.departmentId ?? null;
  const status = input.status && input.status.length > 0 ? input.status : null;

  const { TICKET_STATUS_LABELS, CREATED_VIA_LABELS } = await import("@/lib/tickets/types");

  const tickets = await db.ticket.findMany({
    where: {
      createdAt: { gte: since },
      ...(departmentId ? { departmentId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      number: true,
      subject: true,
      status: true,
      createdVia: true,
      createdAt: true,
      firstResponseAt: true,
      resolvedAt: true,
      department: { select: { name: true } },
      assignedTo: { select: { name: true, username: true } },
    },
    take: 5000,
  });

  const lines: string[] = [CSV_HEADERS.map((h) => csvEscape(h)).join(",")];
  for (const t of tickets) {
    lines.push(
      [
        String(t.number),
        t.subject,
        t.department.name,
        TICKET_STATUS_LABELS[t.status] ?? t.status,
        CREATED_VIA_LABELS[t.createdVia] ?? t.createdVia,
        t.assignedTo ? `${t.assignedTo.name} (@${t.assignedTo.username})` : "—",
        t.createdAt.toISOString(),
        t.firstResponseAt?.toISOString() ?? "",
        t.resolvedAt?.toISOString() ?? "",
      ]
        .map((v) => csvEscape(v))
        .join(",")
    );
  }

  const stamp = dayKey(new Date());
  return {
    filename: `tickets-report-${stamp}.csv`,
    // UTF-8 BOM keeps Excel from mangling Persian text.
    body: "\uFEFF" + lines.join("\r\n"),
  };
}
