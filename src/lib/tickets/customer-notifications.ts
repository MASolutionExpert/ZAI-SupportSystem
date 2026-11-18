import "server-only";

import { db } from "@/lib/db";

/**
 * Customer portal notifications (Phase 4) — read/mark model over the shared
 * Notification table, strictly scoped to one customer profile
 * (recipientType="CUSTOMER" + recipientCustomerId). Titles/bodies are Persian
 * copy produced by the ticketing service; the raw national ID never appears
 * in this module.
 */

const NOTIFICATIONS_TAKE = 30;
const MAX_MARK_IDS = 100;

export type CustomerNotificationView = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  readAt: string | null;
  createdAt: string;
};

export type CustomerNotificationsResult = {
  ok: true;
  data: { notifications: CustomerNotificationView[]; unreadCount: number };
};

/** Newest-first page (take 30) of the customer's notifications + unread count. */
export async function listCustomerNotifications(
  customerId: string
): Promise<CustomerNotificationsResult> {
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { recipientType: "CUSTOMER", recipientCustomerId: customerId },
      orderBy: { createdAt: "desc" },
      take: NOTIFICATIONS_TAKE,
      include: { ticket: { select: { number: true } } },
    }),
    db.notification.count({
      where: { recipientType: "CUSTOMER", recipientCustomerId: customerId, readAt: null },
    }),
  ]);

  return {
    ok: true,
    data: {
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        ticketId: n.ticketId,
        ticketNumber: n.ticket?.number ?? null,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
    },
  };
}

/**
 * Mark the given notification ids (or, when omitted/empty, ALL unread ones)
 * as read for this customer. The recipient scope is always enforced in the
 * WHERE clause — ids belonging to another customer can never be touched.
 */
export async function markCustomerNotificationsRead(
  customerId: string,
  ids?: string[]
): Promise<{ ok: true; data: { updated: number } }> {
  const scoped = {
    recipientType: "CUSTOMER" as const,
    recipientCustomerId: customerId,
    readAt: null,
  };

  const where =
    ids && ids.length > 0
      ? { ...scoped, id: { in: ids.slice(0, MAX_MARK_IDS) } }
      : scoped;

  const result = await db.notification.updateMany({
    where,
    data: { readAt: new Date() },
  });

  return { ok: true, data: { updated: result.count } };
}
