import "server-only";

import { db } from "@/lib/db";

/**
 * Operator notifications (Phase 4) — in-app bell feed for staff users.
 *
 * Rows live in the shared Notification model with recipientType="OPERATOR";
 * customer-facing rows (recipientType="CUSTOMER") are never visible here.
 */

export type OperatorNotificationView = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  readAt: string | null;
  createdAt: string;
};

const FEED_SIZE = 30;

/** Newest-first feed (30 rows) + unread counter for the bell badge. */
export async function listOperatorNotifications(
  userId: string
): Promise<{
  notifications: OperatorNotificationView[];
  unreadCount: number;
}> {
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { recipientType: "OPERATOR", recipientUserId: userId },
      orderBy: { createdAt: "desc" },
      take: FEED_SIZE,
      include: { ticket: { select: { number: true } } },
    }),
    db.notification.count({
      where: { recipientType: "OPERATOR", recipientUserId: userId, readAt: null },
    }),
  ]);

  return {
    notifications: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      ticketId: n.ticketId,
      ticketNumber: n.ticket?.number ?? null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

/**
 * Mark notifications as read. With ids → only those (still ownership-checked);
 * without ids → every unread row of the user.
 */
export async function markOperatorNotificationsRead(
  userId: string,
  ids?: string[]
): Promise<{ marked: number }> {
  const base = { recipientType: "OPERATOR", recipientUserId: userId, readAt: null };
  const where =
    ids && ids.length > 0
      ? { ...base, id: { in: ids.slice(0, 100) } }
      : base;

  const result = await db.notification.updateMany({
    where,
    data: { readAt: new Date() },
  });
  return { marked: result.count };
}
