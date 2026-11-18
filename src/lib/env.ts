import { z } from "zod";

/**
 * Central environment configuration — validated once, fail fast.
 * Never import this from client components (server-only values).
 */

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /** Session/CSRF integrity secret — required outside local development. */
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),

  /**
   * App-level encryption key for secrets at rest (AI API keys now; customer
   * PII from Phase 4). AES-256-GCM. When absent, AUTH_SECRET is the key
   * material source (development convenience — set a dedicated key in prod).
   */
  APP_ENCRYPTION_KEY: z.string().optional(),

  /** Canonical public URL (used for strict origin checks when set). */
  APP_URL: z.string().optional(),

  /**
   * Additional same-origin hosts accepted by the CSRF origin check
   * (comma-separated, e.g. "app.example.com,preview.example.com:8443").
   * Use when reverse-proxy chains rewrite the Host header so the original
   * client-facing origin no longer appears in any forwarded header.
   */
  APP_TRUSTED_ORIGINS: z.string().optional(),

  /** Initial Super Admin bootstrap credentials (used only on empty systems). */
  SUPERADMIN_USERNAME: z.string().default("admin"),
  SUPERADMIN_PASSWORD: z.string().optional(),

  BOOTSTRAP_ON_STARTUP: z
    .enum(["true", "false"])
    .default("true"),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(168),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),

  /**
   * Per-IP sliding-window login throttle (credential-stuffing guard).
   * Defaults keep production strict (10 logins / 60 s per IP); CI and the
   * verification suites raise the limit so consecutive suites do not trip
   * the guard while it remains fully exercised by the lockout tests.
   */
  LOGIN_IP_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  LOGIN_IP_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),

  STORAGE_DIR: z.string().default("./storage"),
  FORCE_SECURE_COOKIES: z.enum(["true", "false"]).default("false"),

  /**
   * Shared cache (Redis). Optional: when absent the app falls back to the
   * in-process L1 cache only (single-node dev/deployments). Docker compose
   * sets redis://cache:6379 automatically.
   */
  REDIS_URL: z.string().optional(),
});

export type AppEnv = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Development fallbacks — production keeps fail-fast validation.
//
// Rationale: hosting sandboxes / disposable dev machines can reset the project
// root between restarts, leaving ".env" truncated. A hard outage (login 500,
// no bootstrap) from a wiped dev ".env" is a worse developer experience than a
// loud, deterministic fallback. All three properties make this safe:
//   1. Gated to NODE_ENV !== "production" — `next build` / `next start` and
//      any real deployment run with NODE_ENV=production and keep the strict
//      contract (missing AUTH_SECRET there still refuses to boot).
//   2. Deterministic values — sessions, CSRF tokens and the AES-256-GCM key
//      material (APP_ENCRYPTION_KEY || AUTH_SECRET) stay stable across
//      restarts, so nothing encrypted at rest becomes unreadable and users
//      are not logged out on every restart.
//   3. Loudly logged on every use — the warning makes the fallback state
//      visible in dev.log; it is never silent.
// The super-admin fallback only matters on the FIRST bootstrap of an empty
// system (runBootstrap never overwrites an existing super admin).
// ---------------------------------------------------------------------------
const DEV_FALLBACK_AUTH_SECRET =
  "supportdesk-dev-fallback-auth-secret-2026-do-not-use-in-production";
const DEV_FALLBACK_SUPERADMIN_PASSWORD = "Admin2026SecureX";

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const source: Record<string, string | undefined> = { ...process.env };
  if (process.env.NODE_ENV !== "production") {
    if (!source.AUTH_SECRET) {
      source.AUTH_SECRET = DEV_FALLBACK_AUTH_SECRET;
      console.warn(
        "[env] AUTH_SECRET missing — using the deterministic DEVELOPMENT fallback. " +
          "Production deployments must always provide AUTH_SECRET."
      );
    }
    if (!source.SUPERADMIN_PASSWORD) {
      source.SUPERADMIN_PASSWORD = DEV_FALLBACK_SUPERADMIN_PASSWORD;
      console.warn(
        "[env] SUPERADMIN_PASSWORD missing — the demo fallback password will be used " +
          "only if the initial super admin does not exist yet (development only)."
      );
    }
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
