# Task 4-b — Operator Ticket Workspace (Staff Side) — Work Record

Agent: 4-b (operator ticketing surface + staff APIs)
Date: 2026-11-16
Status: DONE — `bunx tsc --noEmit` clean, `bun run lint` clean.

## Files created
- `src/lib/tickets/operator-notifications.ts` — `listOperatorNotifications(userId)` (30 newest, joins ticket number, unreadCount) + `markOperatorNotificationsRead(userId, ids?)` (ownership-checked updateMany on readAt).
- `src/app/api/staff/tickets/route.ts` — GET list (q/status/departmentId/assigneeId), POST multipart internal create (201).
- `src/app/api/staff/tickets/[id]/route.ts` — GET detail.
- `src/app/api/staff/tickets/[id]/messages/route.ts` — POST multipart reply/internal-note; permission chosen by isInternalNote (tickets.notes.add vs tickets.reply) via `can()`.
- `src/app/api/staff/tickets/[id]/status/route.ts` — POST zod {toStatus, note?}.
- `src/app/api/staff/tickets/[id]/assign/route.ts` — POST {targetUserId?} (absent/"auto" → fair auto-assign).
- `src/app/api/staff/tickets/[id]/assignees/route.ts` — GET eligible operators (ACTIVE+available dept members with tickets.reply) + activeLoad groupBy.
- `src/app/api/staff/tickets/[id]/transfer/route.ts` — POST {departmentId}.
- `src/app/api/staff/customers/[id]/route.ts` — GET customer history.
- `src/app/api/staff/notifications/route.ts` — GET feed (any staff), POST mark-read {ids?} + same-origin.
- `src/app/api/staff/tickets/attachments/[id]/route.ts` — GET authorized byte download (Content-Type, Content-Disposition with UTF-8 filename*, 404 Persian when file missing on disk).
- `src/components/staff/tickets-queue.tsx` — operator queue (filters + debounced search 400ms, 30s poll, list, detail Sheet side=left sm:max-w-xl, transitions from TICKET_TRANSITIONS, auto/manual assign, transfer dialog, customer-history dialog, internal-note bubbles, composer with Switch + files, internal-create dialog).
- `src/components/staff/notifications-bell.tsx` — header bell (badge, popover feed, mark one/all read, 30s poll).

## Files modified
- `src/components/shell/admin-shell.tsx` — only added `NotificationsBell` inside the header `ms-auto` flex row before the user DropdownMenu. Nothing else touched.
- `src/app/support/page.tsx` — replaced the dashed «گفتگوها و تیکت‌ها» phase-notice card with section heading «مدیریت تیکت‌ها (فاز ۴)» + `<TicketsQueue/>` ABOVE ConversationsInbox; kept availability/departments/permissions cards + inbox (canResolve now fed by the same canStatus = tickets.status.change as before); removed the future-work copy; added tickets.create.internal + tickets.customer.history.view to SUPPORT_PERMISSION_KEYS.

## Notes for other agents
- IMPORTANT (env): the dev server booted at 09:16 held a stale in-memory PrismaClient (pre-Phase-4). I triggered a server restart via `touch next.config.ts` (content unchanged — Next dev auto-restarts on config mtime change). Without it, every Phase-4 endpoint 500s with "db.ticket is undefined". If you see that again, the fix is a server restart, not code.
- DEADLOCK (already fixed in the shared foundation by agent 4-a, do not regress): `audit()` on the global `db` client inside an interactive transaction deadlocks on SQLite single-writer (P2028 after 5 s). service.ts now has `auditInTx(tx, …)` used in upsertCustomerProfile + createTicketCore. I briefly patched `src/lib/audit.ts` with an optional tx param, then REVERTED it byte-for-byte once I saw 4-a's fix landed — audit.ts is back to its original state.
- Smoke-tested end-to-end as operator1 (temporary ALLOW overrides for the 4 operator-only keys, removed afterwards): internal create w/ PNG attachment → fair-assigned to operator2; list/detail/assignees(loads)/assign auto/reply/internal note/status WAITING_CUSTOMER→RESOLVED→CLOSED→OPEN reopen/transfer/attachment download (bytes identical, filename* header)/customer history (masked NID)/notifications feed (TICKET_ASSIGNED + TICKET_TRANSFERRED + queue rows) → mark-all-read (marked=4, unread 0→4→0).
- Demo data note: ticket #1 in DB was created by agent 4-a's portal tests; my test data: customer «مراجع نمونه تست» (NID 0012345679), ticket #2 (now in دپارتمان عضویت, status OPEN) + its messages/attachments/notifications remain as demo rows. Harmless; admin can delete via deleteTicketDeep if undesired.
