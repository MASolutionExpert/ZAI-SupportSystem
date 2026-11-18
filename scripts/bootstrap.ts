/**
 * Explicit bootstrap command — `bun run bootstrap`.
 *
 * Runs the same idempotent bootstrap as server startup:
 *  - seeds the permission catalog and system roles,
 *  - creates the initial super admin ONLY if none exists (from
 *    SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD; never overwrites).
 *
 * Usage:
 *   bun run bootstrap
 *   BOOTSTRAP_ON_STARTUP=false bun run bootstrap   # same, explicit
 */
// Note: bun auto-loads .env from the project root for scripts.
export {}; // ensure this file is a module (isolates it from other scripts)

async function main() {
  const { runBootstrap, ensureDefaultSettings } = await import("../src/lib/bootstrap");

  console.log("▶ Running system bootstrap (idempotent)…");
  const report = await runBootstrap();

  console.log(`✔ Permissions catalog: ${report.permissionsSeeded} keys ensured`);
  console.log(`✔ System roles: ${report.rolesSeeded} ensured`);
  if (report.superAdminCreated) {
    console.log("✔ Initial super admin created (must change password at first login)");
  } else {
    console.log("ℹ Super admin already exists or input missing — nothing overwritten");
  }

  await ensureDefaultSettings();
  console.log("✔ Default organizational settings ensured");

  await (await import("../src/lib/db")).db.$disconnect();
  // Close the cache tier explicitly — an open Redis socket would keep this
  // script alive after the work is done.
  await (await import("@/lib/cache")).shutdownCache();
}

main().catch((error) => {
  console.error("✖ Bootstrap failed:", error);
  process.exit(1);
});
