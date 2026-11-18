import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  parseBody,
  requireAuth,
} from "@/lib/api";
import {
  listOperatorNotifications,
  markOperatorNotificationsRead,
} from "@/lib/tickets/operator-notifications";

export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

/**
 * GET /api/staff/notifications — operator bell feed (30 newest) + unread count.
 * Available to any authenticated staff user.
 */
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const data = await listOperatorNotifications(auth.user.id);
    return apiOk(data);
  } catch (error) {
    console.error("[api/staff/notifications] list failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/**
 * POST /api/staff/notifications {ids?} — mark the given notifications (or all
 * unread ones) as read for the current staff user.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const origin = assertSameOrigin(req);
  if (origin) return origin;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  try {
    const data = await markOperatorNotificationsRead(auth.user.id, body.data.ids);
    return apiOk(data);
  } catch (error) {
    console.error("[api/staff/notifications] mark-read failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
