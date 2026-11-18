import type { NextRequest } from "next/server";
import { apiOk, assertSameOrigin } from "@/lib/api";
import { PORTAL_COOKIE_NAME, portalCookieOptions } from "@/lib/customers/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/portal/logout — clears the portal session cookie
 * (maxAge 0). The signed token itself is stateless, so removal on the
 * client is the entire logout.
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const res = apiOk({ loggedOut: true });
  res.cookies.set(PORTAL_COOKIE_NAME, "", portalCookieOptions(0));
  return res;
}
