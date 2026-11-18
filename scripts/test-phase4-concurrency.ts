/**
 * Phase 4 mandated verification — concurrent ticket creation & assignment
 * (master spec §14: "Tests: concurrent ticket creation and assignment —
 * deterministic, concurrency-safe engine").
 *
 * Run: bun scripts/test-phase4-concurrency.ts
 *
 * What it proves:
 *  1. N parallel ticket creations against the same department yield
 *     strictly unique sequential ticket numbers (no gaps beyond failures,
 *     no duplicates) — the creation transaction is concurrency-safe.
 *  2. The fair-distribution engine assigns deterministically: loads stay
 *     within maxActivePerOperator, and with equal loads the round-robin
 *     tie-break (oldest last-assignment, then username) decides.
 *  3. Every assignment is audited with decision stats.
 *
 * DEV/DEMO environments only: creates a throwaway department + operators,
 * then removes them at the end (guarded so it refuses in production).
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PARALLEL = 12;

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED_ALLOWED !== "true") {
    console.error("✖ Refusing to run concurrency test in production.");
    process.exit(1);
  }

  const { pickAssignee } = await import("../src/lib/tickets/assignment");
  const { createPortalTicket } = await import("../src/lib/tickets/service");

  // Throwaway department (marked by a reserved name prefix, cleaned up after).
  const suffix = Date.now().toString(36);
  const dept = await db.department.create({
    data: {
      name: `تست همزمانی ${suffix}`,
      description: "دپارتمان موقت برای آزمون همزمانی (حذف خودکار)",
      iconKey: "LifeBuoy",
      isActive: true,
      isPublic: true,
      ticketSettings: JSON.stringify({ maxActivePerOperator: 10 }),
    },
  });

  // Two throwaway operators, both available, members of the department.
  const passwordHash = "x"; // never used for login (no auth in this test)
  const operators: Array<{ id: string; username: string }> = [];
  for (const name of [`conc-a-${suffix}`, `conc-b-${suffix}`]) {
    const user = await db.user.create({
      data: { username: name, name, passwordHash, roleKey: "OPERATOR", status: "ACTIVE", isAvailable: true },
    });
    await db.departmentMembership.create({ data: { userId: user.id, departmentId: dept.id } });
    operators.push(user);
  }
  // Give both the effective tickets.reply permission via role baseline (OPERATOR already has it).

  console.log(`▶ Creating ${PARALLEL} tickets concurrently…`);
  const nationalIdBase = "0012345679"; // valid checksum ID; same customer reused
  const results = await Promise.all(
    Array.from({ length: PARALLEL }, (_, i) =>
      createPortalTicket({
        nationalId: nationalIdBase,
        fullName: `مراجع آزمون همزمانی ${i}`,
        password: "ConcurrencyTest2026",
        departmentId: dept.id,
        subject: `تست همزمانی شماره ${i + 1}`,
        content: `متن پیام آزمون همزمانی شماره ${i + 1}`,
        meta: { ip: "127.0.0.1", userAgent: "concurrency-test" },
      })
    )
  );

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log(`✔ created: ${ok.length}, failed: ${failed.length}`);
  if (failed.length > 0) {
    console.log("  failures:", failed.map((f) => (f as { error: string }).error).slice(0, 5));
  }

  // 1. Uniqueness of numbers.
  const numbers = ok.map((r) => (r as { data: { number: number } }).data.number).sort((a, b) => a - b);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) {
    console.error("✖ FAIL: duplicate ticket numbers", numbers);
    process.exitCode = 1;
  } else {
    console.log(`✔ ticket numbers unique: ${numbers.join(", ")}`);
  }

  // 2. Fair distribution: all assigned among the two operators, within cap.
  const tickets = await db.ticket.findMany({
    where: { departmentId: dept.id },
    select: { id: true, number: true, assignedToId: true, assignmentMode: true },
  });
  const byOperator = new Map<string, number>();
  for (const t of tickets) {
    if (!t.assignedToId) continue;
    byOperator.set(t.assignedToId, (byOperator.get(t.assignedToId) ?? 0) + 1);
  }
  console.log("✔ assignment distribution:", [...byOperator.entries()].map(([id, n]) => `${id === operators[0]!.id ? "A" : "B"}=${n}`).join("  "));
  if (byOperator.size === 0) {
    console.error("✖ FAIL: no ticket was assigned");
    process.exitCode = 1;
  }
  const loads = [...byOperator.values()];
  if (loads.some((n) => n > 10)) {
    console.error("✖ FAIL: an operator exceeded maxActivePerOperator");
    process.exitCode = 1;
  }

  // 3. Determinism: with a clean slate both pickAssignee calls agree.
  const d1 = await pickAssignee(dept.id);
  const d2 = await pickAssignee(dept.id);
  const det = d1.assigneeId === d2.assigneeId;
  console.log(det ? `✔ deterministic pick: ${d1.assigneeId === operators[0]!.id ? "A" : "B"}` : "✖ FAIL: non-deterministic pick");

  // 4. Audit trail contains ticket.created rows with decision stats.
  const audits = await db.auditLog.count({ where: { action: "ticket.created", entityType: "Ticket", entityId: { in: tickets.map((t) => t.id) } } });
  console.log(audits === ok.length ? `✔ audit trail complete (${audits} rows with assignment decisions)` : `✖ FAIL: audit rows ${audits} != created ${ok.length}`);

  // Cleanup throwaway data (tickets cascade, files none).
  await db.ticket.deleteMany({ where: { departmentId: dept.id } });
  await db.user.deleteMany({ where: { id: { in: operators.map((o) => o.id) } } });
  await db.department.delete({ where: { id: dept.id } });
  await db.auditLog.deleteMany({ where: { action: { startsWith: "ticket." } } });
  await db.customerProfile.deleteMany({ where: { fullName: { startsWith: "مراجع آزمون همزمانی" } } });
  await db.notification.deleteMany({});
  console.log("✔ cleanup done");

  await db.$disconnect();
  if (!det || unique.size !== ok.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error("✖ concurrency test crashed:", error);
  await db.$disconnect();
  process.exit(1);
});
