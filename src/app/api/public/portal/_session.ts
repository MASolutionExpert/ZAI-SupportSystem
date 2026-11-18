import type { NextRequest } from "next/server";
import { PORTAL_COOKIE_NAME, verifyPortalToken } from "@/lib/customers/session";

/**
 * Shared helper for the portal routes — resolves the verified customer id
 * from the signed, httpOnly portal cookie. Returns null when the cookie is
 * absent, tampered with or expired; the caller then answers 401 without
 * leaking the failure reason.
 */
export function resolvePortalCustomer(req: NextRequest): string | null {
  const token = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
  const payload = verifyPortalToken(token);
  return payload ? payload.cid : null;
}
