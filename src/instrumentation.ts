/**
 * Next.js instrumentation — runs once per server process start (Node runtime).
 *
 * Performs the idempotent system bootstrap: permission catalog, system roles,
 * initial super admin (only when missing) and default org settings.
 * A fresh deployment therefore initializes itself securely on first start,
 * while existing deployments are never overwritten (master spec section 9.1).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.BOOTSTRAP_ON_STARTUP === "false") {
    console.log("[bootstrap] skipped by configuration (BOOTSTRAP_ON_STARTUP=false)");
    return;
  }

  try {
    const [{ runBootstrap }, { ensureDefaultSettings }, { pruneExpiredSessions }] =
      await Promise.all([
        import("@/lib/bootstrap"),
        import("@/lib/bootstrap"),
        import("@/lib/auth/session"),
      ]);

    const report = await runBootstrap();
    if (report.superAdminCreated) {
      console.log(
        "[bootstrap] initial super admin account created (forced password change on first login)."
      );
    }
    await ensureDefaultSettings();
    await pruneExpiredSessions().catch(() => undefined);

    // RAG engine background worker — resumes PENDING document jobs from the
    // DB-backed queue (docs/RAG-ENGINE.md §4); never blocks startup.
    const { startRagWorker } = await import("@/lib/rag/jobs");
    startRagWorker();
  } catch (error) {
    // Never crash the server on bootstrap issues — but make them visible.
    console.error("[bootstrap] failed:", error);
  }
}
