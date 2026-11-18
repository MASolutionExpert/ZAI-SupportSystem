import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody } from "@/lib/api";
import {
  listCustomerNotifications,
  markCustomerNotificationsRead,
} from "@/lib/tickets/customer-notifications";
import { resolvePortalCustomer } from "../_session";

export const dynamic = "force-dynamic";

const markSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

/**
 * GET /api/public/portal/notifications — the verified customer's newest 30
 * notifications (join: ticket number) + unread count.
 */
export async function GET(req: NextRequest) {
  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiError("برای مشاهده اعلان‌ها، ابتدا وارد شوید.", 401, "UNAUTHENTICATED");
  }

  try {
    const result = await listCustomerNotifications(customerId);
    return apiOk(result.data);
  } catch (error) {
    console.error("[api/public/portal/notifications] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * POST /api/public/portal/notifications — mark the given ids (or ALL unread
 * ones when the body omits `ids`) as read. Recipient scope is enforced
 * server-side.
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const customerId = resolvePortalCustomer(req);
  if (!customerId) {
    return apiError("برای به‌روزرسانی اعلان‌ها، ابتدا وارد شوید.", 401, "UNAUTHENTICATED");
  }

  const parsed = await parseBody(req, markSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await markCustomerNotificationsRead(customerId, parsed.data.ids);
    return apiOk(result.data);
  } catch (error) {
    console.error("[api/public/portal/notifications] mark-read failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
