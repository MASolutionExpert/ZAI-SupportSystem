import { NextRequest, NextResponse } from "next/server";

/**
 * Edge proxy (formerly "middleware") — coarse routing protection only.
 * Real authorization (session validation, RBAC) is enforced in the backend:
 * server components and API route handlers re-validate against the database.
 */

const SESSION_COOKIE = "sd_session";

/** Route groups that require a session cookie to even reach the app shell. */
const PROTECTED_PREFIXES = ["/admin"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!hasSessionCookie) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/login"],
};
