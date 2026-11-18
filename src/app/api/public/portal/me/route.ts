import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/api";
import { customerPublicView } from "@/lib/customers/identity";
import { db } from "@/lib/db";
import { resolvePortalCustomer } from "../_session";

export const dynamic = "force-dynamic";

const PROFILE_SELECT = {
  id: true,
  fullName: true,
  nationalIdEnc: true,
  status: true,
  createdAt: true,
} as const;

/**
 * GET /api/public/portal/me — session probe for the portal UI. Both a valid
 * and an invalid/absent cookie answer 200: the response only distinguishes
 * between { customer: view } and { customer: null }.
 */
export async function GET(req: NextRequest) {
  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiOk({ customer: null });
  }

  try {
    const profile = await db.customerProfile.findUnique({
      where: { id: customerId },
      select: PROFILE_SELECT,
    });
    if (!profile) {
      return apiOk({ customer: null });
    }
    return apiOk({ customer: customerPublicView(profile) });
  } catch (error) {
    console.error("[api/public/portal/me] failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
