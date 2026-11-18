# Task 4-a — Customer Portal & Ticketing (public portal UI + portal API)

## Status: COMPLETE (tsc clean, lint clean, end-to-end smoke-tested)

## Files created
- `src/lib/tickets/customer-notifications.ts` — server-only read/mark model over `Notification` (recipientType="CUSTOMER"), take 30 newest + unreadCount, join ticket number; `markCustomerNotificationsRead(customerId, ids?)` scopes every WHERE clause by recipient (never touches other customers' rows).
- `src/app/api/public/portal/_session.ts` — `resolvePortalCustomer(req)` → cid | null (verifies `sd_portal` cookie via `verifyPortalToken`).
- `src/app/api/public/portal/_form.ts` — shared multipart helpers: `parseFormData`, `readFormAttachments` (File[] → Buffer, caps 5 files / 10MB with Persian errors; authoritative validation stays in the service).
- `src/app/api/public/portal/verify/request/route.ts` — POST `{nationalId}` → `{delivery, devCode?, expiresInMs}` (devCode only when DEV_INLINE).
- `src/app/api/public/portal/verify/confirm/route.ts` — POST → issues `sd_portal` cookie (TTL 1800s) + returns customerPublicView (masked ID only).
- `src/app/api/public/portal/me/route.ts` — GET → `{customer: view|null}`, 200 in both cases.
- `src/app/api/public/portal/logout/route.ts` — POST, assertSameOrigin, clears cookie (maxAge 0).
- `src/app/api/public/portal/tickets/route.ts` — GET (listCustomerTickets) + POST formData (nationalId, fullName, departmentId, subject, content, files[]) → 201 `{ticketId, number, subject, status, assignedToId, assignedToName, queued}`.
- `src/app/api/public/portal/tickets/[id]/route.ts` — GET verified owner → getCustomerTicket (internal notes hard-filtered server-side).
- `src/app/api/public/portal/tickets/[id]/messages/route.ts` — POST verified owner, formData content + files[] → 201 `{message, status}`.
- `src/app/api/public/portal/notifications/route.ts` — GET list + POST `{ids?}` mark-read.
- `src/app/api/public/portal/attachments/[id]/route.ts` — GET verified owner → bytes, `Content-Disposition: attachment; filename="att"; filename*=UTF-8''…`, content-type/length, no-store, nosniff; missing file → 404 Persian.
- `src/app/portal/page.tsx` — force-dynamic, metadata «پورتال مراجعان», org name header + back link, hero, `<PortalApp>`, sticky footer (`mt-auto`) «فاز ۴ — پورتال مراجعان»; departments loaded from DB (isActive+isPublic, orderBy displayOrder).
- `src/components/portal/portal-app.tsx` — client UX: Tabs ثبت تیکت (default) / تاریخچه تیکت‌ها; OTP 2-step verify with dashed-amber dev-code box («حالت توسعه»), verified chip + logout, notifications card (unread badge, mark-all, click→ticket), ticket list (max-h-96 scroll, status Badges: OPEN=default, IN_PROGRESS=secondary, WAITING_CUSTOMER=outline, RESOLVED=emerald, CLOSED=muted), detail thread (CUSTOMER right / OPERATOR left per spec), attachments download links, reply composer + 20s list polling + 401→session-expiry handling, 5-file picker with size chips. faNum/faBytes/faDateTimeFormat, no server-only imports, relative fetch URLs only, min 44px touch targets, RTL everywhere.

## Files modified
- `src/app/page.tsx` — added emerald portal CTA link («پورتال مراجعان — ثبت تیکت و پیگیری») above the departments grid; existing content intact.
- **DEVIATION (root-cause fix, documented):** `src/lib/tickets/service.ts` — the two `audit(...)` calls that ran INSIDE `db.$transaction` (in `upsertCustomerProfile` and `createTicketCore`) deadlocked 100% of ticket creations on SQLite (tx holds the single writer lock; audit wrote via the global `db` client on another connection → P2028 tx-timeout at 5s). Replaced only those two in-tx calls with a new module-private `auditInTx(tx, …)` that writes the SAME fields through the tx connection with audit()'s never-fail policy. Contract/behavior preserved exactly (same audit rows, single audit per action); no other foundation file touched. Verified by a standalone repro script before/after.

## API contract (all under /api/public/portal, envelope {ok:true,data}|{ok:false,error,code?})
- POST verify/request {nationalId(4..20)} → 200 {delivery:"DEV_INLINE"|"SMS", devCode?, expiresInMs} | 422/429/404/503 Persian errors
- POST verify/confirm {nationalId, code} → 200 customerPublicView + Set-Cookie sd_portal (httpOnly, lax, 1800s)
- GET me → 200 {customer: view|null}
- POST logout → 200 {loggedOut:true} + cookie cleared
- GET tickets → 401 if unverified; 200 {tickets:[…listCustomerTickets shape…]}
- POST tickets (multipart) → 201 {ticketId, number, subject, status, assignedToId, assignedToName, queued} (no OTP required)
- GET tickets/[id] → 200 {ticket:{…, messages:[customer-visible only]}} | 404 foreign/missing
- POST tickets/[id]/messages (multipart content + files[]) → 201 {message, status} (auto-reopen handled by service)
- GET notifications → 200 {notifications:[…30 newest…], unreadCount}
- POST notifications {ids?: string[]} → 200 {updated}
- GET attachments/[id] → 200 bytes | 401/404

## Smoke test results (curl, dev server)
- ticket create 201 (assigned + queued paths), OTP request (DEV_INLINE devCode), duplicate-request 429, confirm+cookie, me, list, detail (internal notes absent), reply w/ attachment (persisted, downloadable with correct headers/bytes), notifications GET/mark-read, logout, no-cookie 401s, cross-customer isolation (foreign ticket/attachment → 404).

## Notes for next agents
- Portal session TTL is 30 min (`PORTAL_SESSION_TTL_MS`); UI handles expiry via 401 on poll.
- Staff replies/status changes create CUSTOMER notifications (written by the service layer) — they appear in the portal notifications card automatically.
- Test data left in dev DB: customers 0012345679 (زهرا محمدی, ticket #1 w/ attachment), 0234567899, 0074852361 (علی رضایی, ticket #3) for manual preview.
