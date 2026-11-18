import "server-only";

import { db } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac/service";
import { ACTIVE_WORKLOAD_STATUSES, type TicketStatus } from "@/lib/tickets/types";

/**
 * Fair-distribution engine (Phase 4, master spec §7.4).
 *
 * Round-robin/least-loaded per department:
 *  - candidates: ACTIVE staff users, availability ON, member of the
 *    department, holding the effective `tickets.reply` permission;
 *  - load: count of tickets in active statuses currently assigned;
 *  - per-operator cap from the department ticket settings
 *    (maxActivePerOperator, default 10) — capped operators are skipped;
 *  - winner: least load → oldest last-assignment (round-robin fairness)
 *    → username (deterministic tie-break).
 *
 * The decision is returned with full candidate statistics so every
 * assignment is auditable (spec §14: fair distribution audited).
 */

export type DepartmentTicketSettings = {
  maxActivePerOperator: number;
};

export const DEFAULT_TICKET_SETTINGS: DepartmentTicketSettings = {
  maxActivePerOperator: 10,
};

/** Parse department ticket settings (JSON column; defaults on any drift). */
export function parseTicketSettings(raw: string | null | undefined): DepartmentTicketSettings {
  if (!raw) return { ...DEFAULT_TICKET_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<DepartmentTicketSettings>;
    return {
      maxActivePerOperator:
        typeof parsed.maxActivePerOperator === "number" &&
        Number.isInteger(parsed.maxActivePerOperator) &&
        parsed.maxActivePerOperator > 0
          ? parsed.maxActivePerOperator
          : DEFAULT_TICKET_SETTINGS.maxActivePerOperator,
    };
  } catch {
    return { ...DEFAULT_TICKET_SETTINGS };
  }
}

export type AssignmentCandidate = {
  userId: string;
  username: string;
  name: string;
  activeLoad: number;
  lastAssignedAt: Date | null;
};

export type AssignmentDecision =
  | { assigneeId: null; reason: "NO_CANDIDATES" | "ALL_AT_LIMIT"; candidates: AssignmentCandidate[] }
  | { assigneeId: string; reason: "LEAST_LOADED"; candidates: AssignmentCandidate[] };

type PrismaTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export type EligibleOperator = {
  userId: string;
  username: string;
  name: string;
};

/**
 * Candidate discovery — deliberately OUTSIDE any write transaction: it uses
 * the global client (cached permission checks, read-only queries). Only the
 * fast load-counting runs inside the transaction, keeping the row-lock hold
 * time minimal (concurrency-safety, spec §14).
 */
export async function computeEligibleOperators(
  departmentId: string
): Promise<EligibleOperator[]> {
  const memberships = await db.departmentMembership.findMany({
    where: { departmentId },
    select: { userId: true },
  });
  const memberIds = memberships.map((m) => m.userId);
  if (memberIds.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: memberIds }, status: "ACTIVE", isAvailable: true },
    select: { id: true, username: true, name: true },
    orderBy: { username: "asc" },
  });

  const eligible: EligibleOperator[] = [];
  for (const user of users) {
    const perms = await getEffectivePermissions(user.id); // 30 s cache
    if (perms.has("tickets.reply")) {
      eligible.push({ userId: user.id, username: user.username, name: user.name });
    }
  }
  return eligible;
}

/**
 * Pick the fairest assignee INSIDE a transaction. Candidate discovery must
 * happen BEFORE the transaction (computeEligibleOperators); this function
 * only runs fast, tx-scoped load queries (deterministic, concurrency-safe).
 */
export async function pickAssigneeInTx(
  tx: PrismaTx,
  departmentId: string,
  eligible: EligibleOperator[]
): Promise<AssignmentDecision> {
  const department = await tx.department.findUnique({
    where: { id: departmentId },
    select: { ticketSettings: true },
  });
  const settings = parseTicketSettings(department?.ticketSettings);

  if (eligible.length === 0) {
    return { assigneeId: null, reason: "NO_CANDIDATES", candidates: [] };
  }
  const candidateIds = eligible.map((u) => u.userId);

  // Active load per candidate (inside tx — the only write-locked work).
  const loads = await tx.ticket.groupBy({
    by: ["assignedToId"],
    where: {
      departmentId,
      assignedToId: { in: candidateIds },
      status: { in: [...ACTIVE_WORKLOAD_STATUSES] },
    },
    _count: { _all: true },
  });
  const loadMap = new Map<string, number>();
  for (const row of loads) {
    if (row.assignedToId) loadMap.set(row.assignedToId, row._count._all);
  }

  // Last assignment time per candidate (round-robin fairness).
  const lastAssignments = await tx.ticket.groupBy({
    by: ["assignedToId"],
    where: { departmentId, assignedToId: { in: candidateIds }, assignedAt: { not: null } },
    _max: { assignedAt: true },
  });
  const lastMap = new Map<string, Date>();
  for (const row of lastAssignments) {
    if (row.assignedToId && row._max.assignedAt) lastMap.set(row.assignedToId, row._max.assignedAt);
  }

  const candidates: AssignmentCandidate[] = eligible.map((u) => ({
    userId: u.userId,
    username: u.username,
    name: u.name,
    activeLoad: loadMap.get(u.userId) ?? 0,
    lastAssignedAt: lastMap.get(u.userId) ?? null,
  }));

  const capEligible = candidates.filter((c) => c.activeLoad < settings.maxActivePerOperator);
  if (capEligible.length === 0) {
    return { assigneeId: null, reason: "ALL_AT_LIMIT", candidates };
  }

  // Deterministic winner: load ↑, last-assigned ↑ (oldest first), username.
  capEligible.sort((a, b) => {
    if (a.activeLoad !== b.activeLoad) return a.activeLoad - b.activeLoad;
    const at = a.lastAssignedAt?.getTime() ?? 0;
    const bt = b.lastAssignedAt?.getTime() ?? 0;
    if (at !== bt) return at - bt;
    return a.username < b.username ? -1 : a.username > b.username ? 1 : 0;
  });

  return { assigneeId: capEligible[0]!.userId, reason: "LEAST_LOADED", candidates };
}

/** Human-readable audit summary of an assignment decision. */
export function describeDecision(
  decision: AssignmentDecision,
  candidateNames: Map<string, string>
): string {
  if (decision.assigneeId) {
    const winner = candidateNames.get(decision.assigneeId) ?? decision.assigneeId;
    const stats = decision.candidates
      .map((c) => `${candidateNames.get(c.userId) ?? c.username}: ${c.activeLoad}`)
      .join("، ");
    return `بار فعال (${stats}) — انتخاب: ${winner}`;
  }
  return decision.reason === "ALL_AT_LIMIT"
    ? `همه اپراتورهای واجد شرایط در سقف بار فعال هستند (${decision.candidates.length} کاندیدا)`
    : "هیچ اپراتور واجد شرایطی در این دپارتمان یافت نشد";
}

/** Non-transactional wrapper for read-only usage (e.g., previews). */
export async function pickAssignee(departmentId: string): Promise<AssignmentDecision> {
  const eligible = await computeEligibleOperators(departmentId);
  return db.$transaction((tx) => pickAssigneeInTx(tx, departmentId, eligible));
}

export type { TicketStatus };
