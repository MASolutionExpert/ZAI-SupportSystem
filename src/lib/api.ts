import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodType } from "zod";
import { resolveSession, SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { getEnv } from "@/lib/env";

/**
 * API helpers: uniform JSON envelope, same-origin (CSRF) enforcement on
 * mutating requests, and deny-by-default authorization guards.
 */

export type ApiError = { ok: false; error: string; code?: string };
export type ApiSuccess<T> = { ok: true; data: T };

export function apiOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(
    { ok: true, data } satisfies ApiSuccess<T>,
    init
  );
}

export function apiError(
  error: string,
  status = 400,
  code?: string,
  headers?: HeadersInit
): NextResponse {
  return NextResponse.json(
    { ok: false, error, code } satisfies ApiError,
    { status, headers }
  );
}

/** Extract client metadata for audit + throttling. */
export function requestMeta(req: NextRequest): {
  ip: string;
  userAgent: string;
} {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0]!.trim()
    : req.headers.get("x-real-ip") ?? "unknown";
  return { ip, userAgent: req.headers.get("user-agent") ?? "" };
}

/**
 * Same-origin enforcement for mutating requests (CSRF defense-in-depth on top
 * of SameSite=Lax cookies).
 *
 * Reference hosts — the request is accepted when the Origin's host matches
 * ANY of them (first match wins, security is preserved because an attacker's
 * origin matches none of OUR hosts):
 *   1. APP_URL host — authoritative when the deployment configures it.
 *   2. Every part of x-forwarded-host — set by reverse proxies; may be a
 *      comma-separated chain accumulated across proxy hops, where the FIRST
 *      part is the original client-facing host.
 *   3. Host header — some proxy chains pass the original host here.
 *   4. req.url host — last resort (unreliable behind proxies).
 *
 * The multi-reference design exists because hosting sandboxes and preview
 * gateways may rewrite Host while adding x-forwarded-host (or vice versa);
 * a single-reference check false-positives legitimate same-origin users
 * behind those proxies (403 ORIGIN_MISMATCH on every mutation).
 *
 * Failures are logged with the full origin/reference picture so proxy
 * anomalies are diagnosable from dev/server logs alone.
 */
export function assertSameOrigin(req: NextRequest): NextResponse | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return null;

  const env = getEnv();
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients (curl without Origin) — allowed; cookie
    // SameSite=Lax already blocks cross-site browser sends.
    return null;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return apiError("درخواست نامعتبر است.", 403, "ORIGIN_MISMATCH");
  }

  const references = new Set<string>();
  const suffixRules: string[] = [];

  if (env.APP_URL) {
    try {
      references.add(new URL(env.APP_URL).host);
    } catch {
      // Malformed APP_URL must not silently disable the check.
      return apiError("درخواست نامعتبر است.", 403, "ORIGIN_MISMATCH");
    }
  }

  // Deployment-configured extra same-origin hosts (proxy chains that rewrite
  // Host entirely). Entries starting with a dot act as suffix rules (e.g.
  // ".space-z.ai" accepts every subdomain of that infra zone — preview
  // panels get a new subdomain per session). Full URLs are reduced to their
  // host part; empty/invalid entries are skipped.
  for (const raw of (env.APP_TRUSTED_ORIGINS ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.startsWith(".")) {
      suffixRules.push(entry.toLowerCase());
    } else if (entry.includes("://")) {
      try {
        references.add(new URL(entry).host);
      } catch {
        // ignore malformed entry
      }
    } else {
      references.add(entry);
    }
  }

  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    for (const part of forwardedHost.split(",")) {
      const trimmed = part.trim();
      if (trimmed) references.add(trimmed);
    }
  }

  const hostHeader = req.headers.get("host");
  if (hostHeader) references.add(hostHeader.trim());

  try {
    references.add(new URL(req.url).host);
  } catch {
    // req.url is always absolute from Next.js — defensive only.
  }

  const originLower = originHost.toLowerCase();
  const originAllowed =
    references.has(originHost) ||
    references.has(originLower) ||
    suffixRules.some(
      (suffix) => originLower.endsWith(suffix) || originLower === suffix.slice(1)
    );

  if (!originAllowed) {
    console.warn(
      "[origin] rejected mutation — " +
        `origin=${origin} · host=${hostHeader ?? "-"} · ` +
        `x-forwarded-host=${forwardedHost ?? "-"} · ` +
        `app-url=${env.APP_URL ?? "-"} · ` +
        `trusted=${env.APP_TRUSTED_ORIGINS ?? "-"} · path=${req.nextUrl.pathname}`
    );
    return apiError("درخواست بین‌دامنه‌ای مجاز نیست.", 403, "ORIGIN_MISMATCH");
  }
  return null;
}

export async function parseBody<T>(
  req: NextRequest,
  schema: ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError("بدنه درخواست معتبر نیست.", 400, "INVALID_JSON"),
    };
  }
  try {
    return { ok: true, data: schema.parse(json) };
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      return {
        ok: false,
        response: apiError(
          first?.message ?? "ورودی نامعتبر است.",
          422,
          "VALIDATION_ERROR"
        ),
      };
    }
    return {
      ok: false,
      response: apiError("ورودی نامعتبر است.", 422, "VALIDATION_ERROR"),
    };
  }
}

export type Guarded =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

/** Require an authenticated, active staff session. */
export async function requireAuth(): Promise<Guarded> {
  const resolved = await resolveSession();
  if (!resolved) {
    return {
      ok: false,
      response: apiError("ابتدا وارد حساب خود شوید.", 401, "UNAUTHENTICATED"),
    };
  }
  return { ok: true, user: resolved.user };
}

/** Require an authenticated session holding a specific permission. */
export async function requirePermission(
  permissionKey: string
): Promise<Guarded> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;

  const allowed = await can(auth.user.id, permissionKey);
  if (!allowed) {
    return {
      ok: false,
      response: apiError("دسترسی لازم را ندارید.", 403, "FORBIDDEN"),
    };
  }
  return auth;
}
