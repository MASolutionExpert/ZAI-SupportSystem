// One-off maintenance script: restore the two demo operators + memberships
// (the seed-demo aborts on existing departments, but Phase 4+ suites need
// operator1/operator2). Idempotent.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const operatorRole = await db.role.findUnique({ where: { key: "OPERATOR" } });
  if (!operatorRole) throw new Error("OPERATOR role missing — run bootstrap first.");

  const passwordHash = await bcrypt.hash("Operator2026DemoX", 12);
  const created: { id: string }[] = [];
  for (const op of [
    { username: "operator1", name: "اپراتور نمونه یک" },
    { username: "operator2", name: "اپراتور نمونه دو" },
  ]) {
    const exists = await db.user.findUnique({ where: { username: op.username } });
    if (exists) {
      created.push({ id: exists.id });
      console.log(`  = ${op.username} already exists`);
      continue;
    }
    const row = await db.user.create({
      data: {
        username: op.username,
        name: op.name,
        passwordHash,
        roleKey: "OPERATOR",
        status: "ACTIVE",
        isAvailable: true,
      },
    });
    created.push({ id: row.id });
    console.log(`  + ${op.username}`);
  }

  const depts = await db.department.findMany({ select: { id: true } });
  for (const d of depts) {
    for (const op of created) {
      await db.departmentMembership.upsert({
        where: { userId_departmentId: { userId: op.id, departmentId: d.id } },
        update: {},
        create: { userId: op.id, departmentId: d.id },
      });
    }
  }
  console.log(`✔ operators ready, memberships ensured across ${depts.length} departments`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
