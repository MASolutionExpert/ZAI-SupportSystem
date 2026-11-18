/**
 * Tickets — shared domain types and Persian labels (Phase 4).
 *
 * Schema convention: status/createdVia/assignmentMode are plain
 * strings validated by these unions at the application layer.
 */

export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;

export type TicketStatus = typeof TICKET_STATUSES[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "جدید",
  IN_PROGRESS: "در حال بررسی",
  WAITING_CUSTOMER: "در انتظار پاسخ مراجع",
  RESOLVED: "حل‌شده",
  CLOSED: "بسته‌شده",
};

/**
 * Allowed transitions — the state machine is enforced server-side for every
 * actor (customer messages may only reopen; operators follow the table).
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "OPEN"],
  CLOSED: ["OPEN"],
};

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export function ticketStatusLabel(value: string): string {
  return isTicketStatus(value) ? TICKET_STATUS_LABELS[value] : value;
}

/** Statuses that count toward an operator's active workload. */
export const ACTIVE_WORKLOAD_STATUSES: readonly TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
];

export const CREATED_VIA_LABELS: Record<TicketCreatedVia, string> = {
  PORTAL: "پورتال مراجعان",
  OPERATOR_INTERNAL: "ثبت داخلی",
  CHAT_HANDOFF: "ارجاع از گفتگو",
};

export const TICKET_CREATED_VIAS = ["PORTAL", "OPERATOR_INTERNAL", "CHAT_HANDOFF"] as const;
export type TicketCreatedVia = typeof TICKET_CREATED_VIAS[number];

export const ASSIGNMENT_MODES = ["AUTO_FAIR", "MANUAL", "TRANSFER", "SELF"] as const;
export type AssignmentMode = typeof ASSIGNMENT_MODES[number];

export const NOTIFICATION_KINDS = [
  "TICKET_ASSIGNED",
  "TICKET_CUSTOMER_REPLY",
  "TICKET_OPERATOR_REPLY",
  "TICKET_TRANSFERRED",
  "TICKET_STATUS_CHANGED",
  "TICKET_UNASSIGNED_QUEUE",
] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];

/** Client-facing ticket message (customer view excludes internal notes). */
export type TicketMessageView = {
  id: string;
  authorType: "CUSTOMER" | "OPERATOR" | "SYSTEM";
  authorLabel: string | null;
  content: string;
  isInternalNote: boolean;
  createdAt: string;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
};
