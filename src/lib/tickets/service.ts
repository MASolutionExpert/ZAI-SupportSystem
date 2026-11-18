import "server-only";

import { audit, type AuditInput } from "@/lib/audit";
import { db } from "@/lib/db";
import { hasDepartmentAccess, resolveDepartmentScope } from "@/lib/rbac/scope";
import { getEffectivePermissions } from "@/lib/rbac/service";
import { decryptNationalId, encryptNationalId, maskNationalId, nationalIdHmac, validateNationalId } from "@/lib/customers/identity";
import { resolveCitizenIdentity } from "@/lib/customers/accounts";
import { describeDecision, computeEligibleOperators, pickAssigneeInTx } from "@/lib/tickets/assignment";
import { deleteAttachmentFile, prepareAttachment, writeAttachmentFile } from "@/lib/tickets/attachments";
import {
  ACTIVE_WORKLOAD_STATUSES,
  TICKET_TRANSITIONS,
  isTicketStatus,
  ticketStatusLabel,
  type AssignmentMode,
  type TicketMessageView,
  type TicketStatus,
} from "@/lib/tickets/types";

/**
 * Ticketing service (Phase 4) — the single domain module behind the public
 * portal, the operator workspace and the chat-handoff linkage.
 *
 * Hard rules (master spec §14 / §6):
 *  - fair distribution runs inside the creation transaction (SQLite
 *    single-writer ⇒ deterministic, concurrency-safe);
 *  - internal notes NEVER reach customer-facing reads (server-filtered);
 *  - the status machine (TICKET_TRANSITIONS) is enforced for every actor;
 *  - every action is audited; assignment decisions are audited WITH stats;
 *  - the customer's national ID never leaves this module unmasked.
 */

const MAX_SUBJECT_CHARS = 150;
const MAX_CONTENT_CHARS = 4000;
const MAX_NAME_CHARS = 80;
const TICKET_LIST_SIZE = 100;
const SUBJECT_EXCERPT_CHARS = 60;

/**
 * In-process serialization for assignment-affecting operations (creation,
 * manual assign, transfer). SQLite is single-node/single-process by design
 * (DATABASE.md): serializing at the application layer keeps interactive
 * transactions uncontended (no pool timeouts / SQLITE_BUSY) while the
 * MAX(number)+1 allocation stays deterministic. Multi-node deployments move
 * to PostgreSQL where row locks take over this role.
 */
let assignmentChain: Promise<unknown> = Promise.resolve();
function withAssignmentLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = assignmentChain.then(fn, fn);
  assignmentChain = next.catch(() => undefined);
  return next;
}

type PrismaTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

type StaffActor = { id: string; username: string; name: string };

type RequestMeta = { ip?: string | null; userAgent?: string | null };

type AttachmentInput = { filename: string; buffer: Buffer };

type PreparedAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storageKey: string;
};

type ServiceError = { ok: false; status: number; error: string };

function fail(status: number, error: string): ServiceError {
  return { ok: false, status, error };
}

/**
 * Audit variant for use INSIDE an interactive transaction. It MUST write
 * through the same `tx` connection: SQLite permits a single writer, so
 * routing the record through the global `db` client while the transaction
 * holds the write lock deadlocks until the tx timeout (P2028). Mirrors
 * audit()'s field mapping and its never-fail policy.
 */
async function auditInTx(tx: PrismaTx, input: AuditInput): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        actorType: input.actorType ?? "SYSTEM",
        actorUserId: input.actorUserId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (error) {
    // Audit failures must never break the main flow — log server-side.
    console.error("[audit] failed to persist audit record (in-tx):", error);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function persistAttachments(
  tx: PrismaTx | typeof db,
  messageId: string,
  inputs: AttachmentInput[]
): Promise<PreparedAttachment[] | string> {
  const prepared: Array<PreparedAttachment & { buffer: Buffer }> = [];
  for (const input of inputs) {
    const check = await prepareAttachment(input.filename, input.buffer);
    if (!check.ok) return check.error;
    prepared.push({
      filename: input.filename.slice(0, 200),
      mimeType: check.mimeType,
      sizeBytes: input.buffer.length,
      checksum: check.checksum,
      storageKey: check.storageKey,
      buffer: input.buffer,
    });
  }
  for (const att of prepared) {
    await writeAttachmentFile(att.storageKey, att.buffer);
    await tx.ticketAttachment.create({
      data: {
        messageId,
        filename: att.filename,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        checksum: att.checksum,
        storageKey: att.storageKey,
      },
    });
  }
  return prepared;
}

function excerpt(content: string, max = SUBJECT_EXCERPT_CHARS): string {
  const single = content.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

async function notifyQueueMembers(
  tx: PrismaTx | typeof db,
  departmentId: string,
  ticketId: string,
  kind: string,
  title: string,
  body: string
): Promise<void> {
  const members = await tx.departmentMembership.findMany({
    where: { departmentId },
    select: { userId: true },
  });
  if (members.length === 0) return;
  await tx.notification.createMany({
    data: members.map((m) => ({
      recipientType: "OPERATOR",
      recipientUserId: m.userId,
      departmentId,
      ticketId,
      kind,
      title,
      body,
    })),
  });
}

async function upsertCustomerProfile(
  tx: PrismaTx | typeof db,
  nationalId: string,
  fullName: string,
  meta?: RequestMeta
) {
  const hmac = nationalIdHmac(nationalId);
  const existing = await tx.customerProfile.findUnique({ where: { nationalIdHmac: hmac } });
  if (existing) {
    const name = fullName || existing.fullName;
    return tx.customerProfile.update({
      where: { id: existing.id },
      data: { fullName: name },
    });
  }
  const created = await tx.customerProfile
    .create({
      data: {
        fullName,
        nationalIdEnc: encryptNationalId(nationalId),
        nationalIdHmac: hmac,
      },
    })
    .catch(async (error) => {
      // Parallel first-contact race: another creation for the same national
      // ID inserted the profile between our find and create (P2002) —
      // fall back to the winner's row instead of failing the request.
      const code = (error as { code?: string } | null)?.code;
      if (code !== "P2002") throw error;
      const winner = await tx.customerProfile.findUnique({ where: { nationalIdHmac: hmac } });
      if (!winner) throw error;
      if (fullName && fullName !== winner.fullName) {
        return tx.customerProfile.update({
          where: { id: winner.id },
          data: { fullName },
        });
      }
      return winner;
    });
  await auditInTx(tx, {
    actorType: "CUSTOMER",
    actorLabel: fullName,
    action: "customer.profile.created",
    entityType: "CustomerProfile",
    entityId: created.id,
    metadata: { via: "TICKET_CREATION" },
    ip: meta?.ip ?? undefined,
    userAgent: meta?.userAgent ?? undefined,
  });
  return created;
}

// ---------------------------------------------------------------------------
// Ticket creation (all channels) + fair distribution
// ---------------------------------------------------------------------------

type CreateTicketCoreInput = {
  departmentId: string;
  customerId: string | null;
  customerName: string | null;
  subject: string;
  firstMessage: string;
  createdVia: "PORTAL" | "OPERATOR_INTERNAL" | "CHAT_HANDOFF";
  conversationId?: string | null;
  attachments?: AttachmentInput[];
};

export type CreateTicketResult = {
  ok: true;
  data: {
    ticketId: string;
    number: number;
    status: TicketStatus;
    assignedToId: string | null;
    assignedToName: string | null;
  };
};

async function createTicketCore(
  input: CreateTicketCoreInput,
  meta: RequestMeta,
  actor: { actorType: "CUSTOMER" | "USER" | "SYSTEM"; actorUserId?: string; actorLabel: string }
): Promise<CreateTicketResult | ServiceError> {
  const subject = input.subject.trim();
  const content = input.firstMessage.trim();
  if (subject.length < 3 || subject.length > MAX_SUBJECT_CHARS) {
    return fail(422, "موضوع تیکت باید بین ۳ تا ۱۵۰ نویسه باشد.");
  }
  if (content.length < 1 || content.length > MAX_CONTENT_CHARS) {
    return fail(422, "متن پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد.");
  }
  if ((input.attachments?.length ?? 0) > 5) {
    return fail(422, "حداکثر ۵ فایل پیوست در هر پیام مجاز است.");
  }

  const department = await db.department.findUnique({
    where: { id: input.departmentId },
    select: { id: true, name: true, isActive: true, isPublic: true },
  });
  if (!department || !department.isActive || (input.createdVia === "PORTAL" && !department.isPublic)) {
    return fail(404, "دپارتمان مقصد یافت نشد یا فعال نیست.");
  }

  // Whole creation runs under the assignment lock (see comment at top):
  // candidate discovery + transaction are serialized per process, so the
  // ticket-number allocation and load-counting are deterministic even when
  // many creations arrive in parallel.
  return withAssignmentLock(async () => {
  const eligible = await computeEligibleOperators(department.id);

  // Retry loop for the unique ticket number under concurrent creation
  // (SQLite serializes writers; P2002 collisions and lock-contention
  // timeouts P2028/P1008 are retried with jittered backoff).
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 120 * attempt + Math.floor(Math.random() * 80)));
    }
    try {
      const result = await db.$transaction(
        async (tx) => {
        const maxRow = await tx.ticket.aggregate({ _max: { number: true } });
        const number = (maxRow._max.number ?? 0) + 1;

        const decision = await pickAssigneeInTx(tx, department.id, eligible);
        const candidateNames = new Map(
          decision.candidates.map((c) => [c.userId, c.name] as const)
        );

        const ticket = await tx.ticket.create({
          data: {
            number,
            departmentId: department.id,
            customerId: input.customerId,
            subject,
            status: "OPEN",
            assignedToId: decision.assigneeId,
            assignedAt: decision.assigneeId ? new Date() : null,
            assignmentMode: decision.assigneeId ? "AUTO_FAIR" : null,
            createdVia: input.createdVia,
            conversationId: input.conversationId ?? null,
            messages: {
              create: {
                // PORTAL and CHAT_HANDOFF first messages are the customer's
                // own words; only OPERATOR_INTERNAL is authored by staff.
                authorType: input.createdVia === "OPERATOR_INTERNAL" ? "OPERATOR" : "CUSTOMER",
                authorId: actor.actorUserId ?? null,
                authorLabel: actor.actorLabel,
                content,
              },
            },
            statusHistory: {
              create: { fromStatus: null, toStatus: "OPEN", actorType: actor.actorType, actorId: actor.actorUserId ?? null, actorLabel: actor.actorLabel },
            },
          },
        });

        const firstMessage = await tx.ticketMessage.findFirst({
          where: { ticketId: ticket.id },
          orderBy: { createdAt: "desc" },
        });
        if (firstMessage && input.attachments && input.attachments.length > 0) {
          const att = await persistAttachments(tx, firstMessage.id, input.attachments);
          if (typeof att === "string") throw new Error(att);
        }

        // Notifications + audit trail (inside the tx for consistency).
        if (decision.assigneeId) {
          await tx.notification.create({
            data: {
              recipientType: "OPERATOR",
              recipientUserId: decision.assigneeId,
              departmentId: department.id,
              ticketId: ticket.id,
              kind: "TICKET_ASSIGNED",
              title: `تیکت جدید #${ticket.number}`,
              body: `${actor.actorLabel}: ${subject}`,
            },
          });
        } else {
          await notifyQueueMembers(
            tx,
            department.id,
            ticket.id,
            "TICKET_UNASSIGNED_QUEUE",
            `تیکت بدون مسئول در صف ${department.name}`,
            `${subject} — از بخش ارجاع، اپراتور تعیین کنید.`
          );
        }

        await auditInTx(tx, {
          actorType: actor.actorType,
          actorUserId: actor.actorUserId,
          actorLabel: actor.actorLabel,
          action: "ticket.created",
          entityType: "Ticket",
          entityId: ticket.id,
          metadata: {
            number: ticket.number,
            departmentId: department.id,
            departmentName: department.name,
            createdVia: input.createdVia,
            assignment: describeDecision(decision, candidateNames),
            assigneeId: decision.assigneeId,
          },
          ip: meta.ip ?? undefined,
          userAgent: meta.userAgent ?? undefined,
        });

        const assigneeName =
          decision.assigneeId != null
            ? candidateNames.get(decision.assigneeId) ?? null
            : null;
        return {
          ticketId: ticket.id,
          number: ticket.number,
          status: "OPEN" as TicketStatus,
          assignedToId: decision.assigneeId,
          assignedToName: assigneeName,
        };
      },
        { timeout: 20_000, maxWait: 10_000 }
      );
      return { ok: true, data: result };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      // P2002: number collision · P2028: transaction timeout/closed ·
      // P1008: operation timeout — all retryable under write contention.
      if ((code === "P2002" || code === "P2028" || code === "P1008") && attempt < 3) {
        lastError = error;
        continue;
      }
      const message = (error as { message?: string } | null)?.message ?? "";
      if (!code && message && !message.startsWith("P")) {
        // Validation error from attachment preparation etc.
        return fail(422, message);
      }
      lastError = error;
    }
  }
  console.error("[tickets] create failed after retries:", lastError);
  return fail(500, "خطای سامانه در ثبت تیکت؛ دوباره تلاش کنید.");
  });
}

/**
 * Public portal ticket creation (Phase 8) — the citizen account is resolved
 * FIRST (register with a first-time password, or login for returning
 * citizens); only then is the ticket created against the profile.
 */
export async function createPortalTicket(input: {
  nationalId: string;
  fullName: string;
  password: string;
  departmentId: string;
  subject: string;
  content: string;
  attachments?: AttachmentInput[];
  meta: RequestMeta;
}): Promise<CreateTicketResult | ServiceError> {
  const identity = await resolveCitizenIdentity({
    nationalId: input.nationalId ?? "",
    fullName: input.fullName ?? "",
    password: input.password ?? "",
    via: "PORTAL_TICKET",
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });
  if (!identity.ok) return identity;

  return createTicketCore(
    {
      departmentId: input.departmentId,
      customerId: identity.profile.id,
      customerName: identity.profile.fullName,
      subject: input.subject,
      firstMessage: input.content,
      createdVia: "PORTAL",
      attachments: input.attachments,
    },
    input.meta,
    { actorType: "CUSTOMER", actorLabel: identity.profile.fullName }
  );
}

/** Internal creation by an operator (permission checked at the route). */
export async function createInternalTicket(input: {
  user: StaffActor;
  nationalId: string;
  fullName: string;
  departmentId: string;
  subject: string;
  content: string;
  attachments?: AttachmentInput[];
  meta: RequestMeta;
}): Promise<CreateTicketResult | ServiceError> {
  if (!(await hasDepartmentAccess(input.user.id, input.departmentId))) {
    return fail(403, "به این دپارتمان دسترسی ندارید.");
  }
  const nationalId = validateNationalId(input.nationalId ?? "");
  if (!nationalId) {
    return fail(422, "کد ملی واردشده معتبر نیست.");
  }
  const fullName = (input.fullName ?? "").trim().slice(0, MAX_NAME_CHARS);
  if (fullName.length < 3) {
    return fail(422, "نام و نام خانوادگی مراجع را کامل وارد کنید.");
  }

  const profile = await upsertCustomerProfile(db, nationalId, fullName, input.meta);

  return createTicketCore(
    {
      departmentId: input.departmentId,
      customerId: profile.id,
      customerName: profile.fullName,
      subject: input.subject,
      firstMessage: input.content,
      createdVia: "OPERATOR_INTERNAL",
      attachments: input.attachments,
    },
    input.meta,
    { actorType: "USER", actorUserId: input.user.id, actorLabel: input.user.name || input.user.username }
  );
}

/**
 * Chat-handoff linkage (Phase 3 ↔ 4): a live conversation that requests an
 * operator gets a tracked ticket (createdVia CHAT_HANDOFF) driven through
 * the same fair-distribution engine. Anonymous conversations create tickets
 * with a null customer (display name falls back to the chat name / مهمان).
 */
export async function createHandoffTicket(input: {
  conversationId: string;
  departmentId: string;
  customerName: string | null;
  customerId?: string | null; // Phase 8: linked citizen account → trackable handoff ticket
  meta: RequestMeta;
}): Promise<{ ticketId: string; number: number; assigneeId: string | null } | null> {
  const firstCustomer = await db.conversationMessage.findFirst({
    where: { conversationId: input.conversationId, role: "CUSTOMER" },
    orderBy: { createdAt: "asc" },
    select: { content: true },
  });

  const result = await createTicketCore(
    {
      departmentId: input.departmentId,
      customerId: input.customerId ?? null,
      customerName: input.customerName,
      subject: firstCustomer ? excerpt(firstCustomer.content) : "گفتگوی ارجاع‌شده از گفتگوی زنده",
      firstMessage: firstCustomer?.content ?? "ارجاع از گفتگوی زنده (بدون پیام متنی پیشین)",
      createdVia: "CHAT_HANDOFF",
      conversationId: input.conversationId,
    },
    input.meta,
    { actorType: "CUSTOMER", actorLabel: input.customerName ?? "مهمان" }
  );
  if (!result.ok) {
    // Honest degrade: the conversation stays queued even if ticketing fails.
    console.error("[tickets] handoff ticket creation failed:", result.error);
    return null;
  }
  return {
    ticketId: result.data.ticketId,
    number: result.data.number,
    assigneeId: result.data.assignedToId,
  };
}

// ---------------------------------------------------------------------------
// Staff reads (scoped)
// ---------------------------------------------------------------------------

export type StaffTicketSummary = {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  statusLabel: string;
  departmentId: string;
  departmentName: string;
  customerId: string | null;
  customerName: string | null;
  customerMaskedNationalId: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdVia: string;
  conversationId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastExcerpt: string | null;
};

export async function listTickets(
  user: StaffActor,
  opts?: {
    q?: string;
    status?: TicketStatus | "open" | "all";
    departmentId?: string;
    assigneeId?: "mine" | "unassigned" | (string & {});
    take?: number;
  }
): Promise<{ ok: true; data: { tickets: StaffTicketSummary[] } } | ServiceError> {
  const scope = await resolveDepartmentScope(user.id);
  const statusFilter = opts?.status ?? "open";

  const where = {
    ...(scope.all ? {} : { departmentId: { in: scope.departmentIds } }),
    ...(opts?.departmentId
      ? scope.all || scope.departmentIds.includes(opts.departmentId)
        ? { departmentId: opts.departmentId }
        : {}
      : {}),
    ...(statusFilter === "open"
      ? { status: { in: [...ACTIVE_WORKLOAD_STATUSES] } }
      : statusFilter !== "all" && isTicketStatus(statusFilter)
        ? { status: statusFilter }
        : {}),
    ...(opts?.assigneeId === "mine"
      ? { assignedToId: user.id }
      : opts?.assigneeId === "unassigned"
        ? { assignedToId: null }
        : opts?.assigneeId
          ? { assignedToId: opts.assigneeId }
          : {}),
    ...(opts?.q
      ? {
          OR: [
            { subject: { contains: opts.q } },
            { customer: { fullName: { contains: opts.q } } },
            { messages: { some: { content: { contains: opts.q } } } },
            ...( /^\d{1,9}$/.test(opts.q) ? [{ number: Number(opts.q) }] : []),
          ],
        }
      : {}),
  };

  const tickets = await db.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(opts?.take ?? TICKET_LIST_SIZE, TICKET_LIST_SIZE),
    include: {
      department: { select: { name: true } },
      customer: { select: { id: true, fullName: true, nationalIdEnc: true } },
      assignedTo: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, isInternalNote: true, authorType: true } },
    },
  });

  return {
    ok: true,
    data: {
      tickets: tickets.map((t) => {
        const last = t.messages[0];
        const nid = t.customer ? decryptNationalId(t.customer.nationalIdEnc) : null;
        return {
          id: t.id,
          number: t.number,
          subject: t.subject,
          status: t.status as TicketStatus,
          statusLabel: ticketStatusLabel(t.status),
          departmentId: t.departmentId,
          departmentName: t.department.name,
          customerId: t.customerId,
          customerName: t.customer?.fullName ?? null,
          customerMaskedNationalId: nid ? maskNationalId(nid) : null,
          assignedToId: t.assignedToId,
          assignedToName: t.assignedTo?.name ?? null,
          createdVia: t.createdVia,
          conversationId: t.conversationId,
          messageCount: t._count.messages,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
          lastExcerpt: last && !last.isInternalNote ? excerpt(last.content, 90) : last ? "یادداشت داخلی" : null,
        };
      }),
    },
  };
}

function toMessageView(m: {
  id: string;
  authorType: string;
  authorId: string | null;
  authorLabel: string | null;
  content: string;
  isInternalNote: boolean;
  createdAt: Date;
  attachments: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>;
}): TicketMessageView {
  return {
    id: m.id,
    authorType: m.authorType as TicketMessageView["authorType"],
    authorLabel: m.authorLabel,
    content: m.content,
    isInternalNote: m.isInternalNote,
    createdAt: m.createdAt.toISOString(),
    attachments: m.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })),
  };
}

export async function getStaffTicket(
  user: StaffActor,
  ticketId: string
): Promise<
  | {
      ok: true;
      data: {
        ticket: StaffTicketSummary & {
          firstResponseAt: string | null;
          resolvedAt: string | null;
          closedAt: string | null;
          messages: TicketMessageView[];
          statusHistory: Array<{
            id: string;
            fromStatus: string | null;
            toStatus: string;
            actorType: string;
            actorLabel: string | null;
            note: string | null;
            createdAt: string;
          }>;
        };
      };
    }
  | ServiceError
> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      department: { select: { name: true } },
      customer: { select: { id: true, fullName: true, nationalIdEnc: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } } },
      },
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");

  const allowed = await hasDepartmentAccess(user.id, ticket.departmentId);
  if (!allowed) return fail(403, "به این تیکت دسترسی ندارید.");

  const nid = ticket.customer ? decryptNationalId(ticket.customer.nationalIdEnc) : null;
  return {
    ok: true,
    data: {
      ticket: {
        id: ticket.id,
        number: ticket.number,
        subject: ticket.subject,
        status: ticket.status as TicketStatus,
        statusLabel: ticketStatusLabel(ticket.status),
        departmentId: ticket.departmentId,
        departmentName: ticket.department.name,
        customerId: ticket.customerId,
        customerName: ticket.customer?.fullName ?? null,
        customerMaskedNationalId: nid ? maskNationalId(nid) : null,
        assignedToId: ticket.assignedToId,
        assignedToName: ticket.assignedTo?.name ?? null,
        createdVia: ticket.createdVia,
        conversationId: ticket.conversationId,
        messageCount: ticket.messages.length,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
        resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
        closedAt: ticket.closedAt?.toISOString() ?? null,
        lastExcerpt: null,
        messages: ticket.messages.map(toMessageView),
        statusHistory: ticket.statusHistory.map((h) => ({
          id: h.id,
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          actorType: h.actorType,
          actorLabel: h.actorLabel,
          note: h.note,
          createdAt: h.createdAt.toISOString(),
        })),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Customer (portal) reads — internal notes NEVER included
// ---------------------------------------------------------------------------

export async function listCustomerTickets(
  customerId: string
): Promise<{
  ok: true;
  data: {
    tickets: Array<{
      id: string;
      number: number;
      subject: string;
      status: TicketStatus;
      statusLabel: string;
      departmentId: string;
      departmentName: string;
      assignedToId: string | null;
      assignedToName: string | null;
      messageCount: number;
      createdAt: string;
      updatedAt: string;
      lastExcerpt: string | null;
    }>;
  };
}> {
  const tickets = await db.ticket.findMany({
    where: { customerId },
    orderBy: { updatedAt: "desc" },
    take: TICKET_LIST_SIZE,
    include: {
      department: { select: { name: true } },
      assignedTo: { select: { name: true } },
      // Count only customer-visible messages — internal notes must not leak
      // their existence through metadata (content is already filtered out in
      // getCustomerTicket; the count must follow the same rule).
      _count: { select: { messages: { where: { isInternalNote: false } } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, isInternalNote: true, authorType: true },
      },
    },
  });

  return {
    ok: true,
    data: {
      tickets: tickets.map((t) => {
        const last = t.messages[0];
        return {
          id: t.id,
          number: t.number,
          subject: t.subject,
          status: t.status as TicketStatus,
          statusLabel: ticketStatusLabel(t.status),
          departmentId: t.departmentId,
          departmentName: t.department.name,
          assignedToId: t.assignedToId,
          assignedToName: t.assignedTo?.name ?? null,
          messageCount: t._count.messages,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
          lastExcerpt: last && !last.isInternalNote ? excerpt(last.content, 90) : null,
        };
      }),
    },
  };
}

export async function getCustomerTicket(
  customerId: string,
  ticketId: string
): Promise<
  | {
      ok: true;
      data: {
        ticket: {
          id: string;
          number: number;
          subject: string;
          status: TicketStatus;
          statusLabel: string;
          departmentName: string;
          assignedToName: string | null;
          createdAt: string;
          messages: TicketMessageView[]; // internal notes filtered OUT
        };
      };
    }
  | ServiceError
> {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, customerId },
    include: {
      department: { select: { name: true } },
      assignedTo: { select: { name: true } },
      messages: {
        where: { isInternalNote: false }, // hard server-side filter — spec §14
        orderBy: { createdAt: "asc" },
        include: { attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } } },
      },
    },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");

  return {
    ok: true,
    data: {
      ticket: {
        id: ticket.id,
        number: ticket.number,
        subject: ticket.subject,
        status: ticket.status as TicketStatus,
        statusLabel: ticketStatusLabel(ticket.status),
        departmentName: ticket.department.name,
        assignedToName: ticket.assignedTo?.name ?? null,
        createdAt: ticket.createdAt.toISOString(),
        messages: ticket.messages.map(toMessageView),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export async function addCustomerTicketMessage(input: {
  customerId: string;
  ticketId: string;
  content: string;
  attachments?: AttachmentInput[];
  meta: RequestMeta;
}): Promise<{ ok: true; data: { message: TicketMessageView; status: TicketStatus } } | ServiceError> {
  const content = input.content.trim();
  if (content.length < 1 || content.length > MAX_CONTENT_CHARS) {
    return fail(422, "متن پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد.");
  }
  if ((input.attachments?.length ?? 0) > 5) {
    return fail(422, "حداکثر ۵ فایل پیوست در هر پیام مجاز است.");
  }

  const ticket = await db.ticket.findFirst({
    where: { id: input.ticketId, customerId: input.customerId },
    select: { id: true, number: true, status: true, assignedToId: true, customerId: true },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");

  const status = ticket.status as TicketStatus;

  // Customer reply transitions (every change writes a history entry):
  //  - RESOLVED/CLOSED → OPEN (reopen);
  //  - WAITING_CUSTOMER → IN_PROGRESS (operator engaged again);
  //  - OPEN/IN_PROGRESS stay unchanged (message only bumps the thread).
  let nextStatus: TicketStatus = status;
  if (status === "RESOLVED" || status === "CLOSED") {
    const reopened = await applyTransition({
      ticketId: ticket.id,
      fromStatus: status,
      toStatus: "OPEN",
      actorType: "CUSTOMER",
      actorLabel: "مراجع",
      note: "بازگشایی با پیام جدید مراجع",
    });
    if (!reopened.ok) return fail(409, "امکان بازگشایی این تیکت وجود ندارد.");
    nextStatus = "OPEN";
  } else if (status === "WAITING_CUSTOMER") {
    const engaged = await applyTransition({
      ticketId: ticket.id,
      fromStatus: status,
      toStatus: "IN_PROGRESS",
      actorType: "CUSTOMER",
      actorLabel: "مراجع",
      note: "پاسخ مراجع پس از درخواست اطلاعات",
    });
    if (!engaged.ok) return fail(409, "امکان ثبت پاسخ در وضعیت فعلی وجود ندارد.");
    nextStatus = "IN_PROGRESS";
  }

  const created = await db.$transaction(async (tx) => {
    const message = await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: "CUSTOMER",
        authorLabel: null,
        content,
      },
    });
    if (input.attachments && input.attachments.length > 0) {
      const att = await persistAttachments(tx, message.id, input.attachments);
      if (typeof att === "string") throw new Error(att);
    }
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: nextStatus, updatedAt: new Date() },
    });
    if (ticket.assignedToId) {
      await tx.notification.create({
        data: {
          recipientType: "OPERATOR",
          recipientUserId: ticket.assignedToId,
          ticketId: ticket.id,
          kind: "TICKET_CUSTOMER_REPLY",
          title: `پاسخ جدید مراجع در تیکت #${ticket.number}`,
          body: excerpt(content, 80),
        },
      });
    } else {
      const t = await tx.ticket.findUnique({ where: { id: ticket.id }, select: { departmentId: true } });
      if (t) {
        await notifyQueueMembers(
          tx,
          t.departmentId,
          ticket.id,
          "TICKET_CUSTOMER_REPLY",
          `پاسخ مراجع در تیکت بدون مسئول #${ticket.number}`,
          excerpt(content, 80)
        );
      }
    }
    return message;
  });

  await audit({
    actorType: "CUSTOMER",
    action: "ticket.customer.replied",
    entityType: "Ticket",
    entityId: ticket.id,
    metadata: { number: ticket.number, messageId: created.id },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return {
    ok: true,
    data: { message: toMessageView({ ...created, attachments: [] }), status: "OPEN" },
  };
}

export async function addStaffTicketMessage(input: {
  user: StaffActor;
  ticketId: string;
  content: string;
  isInternalNote: boolean;
  attachments?: AttachmentInput[];
  meta: RequestMeta;
}): Promise<{ ok: true; data: { message: TicketMessageView; status: TicketStatus } } | ServiceError> {
  const content = input.content.trim();
  if (content.length < 1 || content.length > MAX_CONTENT_CHARS) {
    return fail(422, "متن پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد.");
  }
  if ((input.attachments?.length ?? 0) > 5) {
    return fail(422, "حداکثر ۵ فایل پیوست در هر پیام مجاز است.");
  }

  const ticket = await db.ticket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, number: true, status: true, assignedToId: true, customerId: true, departmentId: true },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");
  if (!(await hasDepartmentAccess(input.user.id, ticket.departmentId))) {
    return fail(403, "به این تیکت دسترسی ندارید.");
  }

  const status = ticket.status as TicketStatus;
  if (status === "RESOLVED" || status === "CLOSED") {
    return fail(409, "این تیکت پایان‌یافته است؛ ابتدا آن را بازگشایی کنید.");
  }

  const authorLabel = input.user.name || input.user.username;
  const now = new Date();

  const created = await db.$transaction(async (tx) => {
    const message = await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: "OPERATOR",
        authorId: input.user.id,
        authorLabel,
        content,
        isInternalNote: input.isInternalNote,
      },
    });
    if (input.attachments && input.attachments.length > 0) {
      const att = await persistAttachments(tx, message.id, input.attachments);
      if (typeof att === "string") throw new Error(att);
    }

    const updates: Record<string, unknown> = { updatedAt: now };
    if (!input.isInternalNote) {
      const current = await tx.ticket.findUnique({ where: { id: ticket.id }, select: { firstResponseAt: true } });
      if (!current?.firstResponseAt) updates.firstResponseAt = now;
      // Reply without assignment self-assigns (mirrors conversations).
      if (!ticket.assignedToId) {
        updates.assignedToId = input.user.id;
        updates.assignedAt = now;
        updates.assignmentMode = "SELF";
      }
      if (status === "OPEN" || status === "WAITING_CUSTOMER") {
        updates.status = "IN_PROGRESS";
        await tx.ticketStatusHistory.create({
          data: {
            ticketId: ticket.id,
            fromStatus: status,
            toStatus: "IN_PROGRESS",
            actorType: "OPERATOR",
            actorId: input.user.id,
            actorLabel: authorLabel,
            note: "پاسخ اپراتور",
          },
        });
      }
    }
    await tx.ticket.update({ where: { id: ticket.id }, data: updates });

    if (!input.isInternalNote && ticket.customerId) {
      await tx.notification.create({
        data: {
          recipientType: "CUSTOMER",
          recipientCustomerId: ticket.customerId,
          ticketId: ticket.id,
          departmentId: ticket.departmentId,
          kind: "TICKET_OPERATOR_REPLY",
          title: `پاسخ جدید در تیکت #${ticket.number}`,
          body: excerpt(content, 80),
        },
      });
    }
    return message;
  });

  await audit({
    actorType: "USER",
    actorUserId: input.user.id,
    actorLabel: input.user.username,
    action: input.isInternalNote ? "ticket.internal_note.added" : "ticket.operator.replied",
    entityType: "Ticket",
    entityId: ticket.id,
    metadata: { number: ticket.number, messageId: created.id, internal: input.isInternalNote },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return { ok: true, data: { message: toMessageView({ ...created, attachments: [] }), status: "IN_PROGRESS" } };
}

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

async function applyTransition(input: {
  ticketId: string;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  actorType: "CUSTOMER" | "OPERATOR" | "SYSTEM";
  actorId?: string;
  actorLabel?: string;
  note?: string;
}): Promise<{ ok: true } | ServiceError> {
  if (!TICKET_TRANSITIONS[input.fromStatus]?.includes(input.toStatus)) {
    return fail(409, `گذار وضعیت از ${ticketStatusLabel(input.fromStatus)} به ${ticketStatusLabel(input.toStatus)} مجاز نیست.`);
  }
  const now = new Date();
  const data: Record<string, unknown> = { status: input.toStatus, updatedAt: now };
  if (input.toStatus === "RESOLVED") data.resolvedAt = now;
  if (input.toStatus === "CLOSED") data.closedAt = now;
  if (input.toStatus === "OPEN") {
    data.resolvedAt = null;
    data.closedAt = null;
  }
  await db.ticket.update({ where: { id: input.ticketId }, data });
  await db.ticketStatusHistory.create({
    data: {
      ticketId: input.ticketId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      note: input.note ?? null,
    },
  });
  return { ok: true };
}

export async function changeTicketStatus(input: {
  user: StaffActor;
  ticketId: string;
  toStatus: string;
  note?: string;
  meta: RequestMeta;
}): Promise<{ ok: true; data: { status: TicketStatus } } | ServiceError> {
  const toStatus = input.toStatus;
  if (!isTicketStatus(toStatus)) return fail(422, "وضعیت نامعتبر است.");

  const ticket = await db.ticket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, number: true, status: true, customerId: true, assignedToId: true, departmentId: true },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");
  if (!(await hasDepartmentAccess(input.user.id, ticket.departmentId))) {
    return fail(403, "به این تیکت دسترسی ندارید.");
  }

  const fromStatus = ticket.status as TicketStatus;
  const result = await applyTransition({
    ticketId: ticket.id,
    fromStatus,
    toStatus,
    actorType: "OPERATOR",
    actorId: input.user.id,
    actorLabel: input.user.name || input.user.username,
    note: input.note?.trim() || undefined,
  });
  if (!result.ok) return result;

  const actorLabel = input.user.name || input.user.username;
  await db.notification.createMany({
    data: [
      ...(ticket.customerId
        ? [
            {
              recipientType: "CUSTOMER",
              recipientCustomerId: ticket.customerId,
              ticketId: ticket.id,
              departmentId: ticket.departmentId,
              kind: "TICKET_STATUS_CHANGED",
              title: `تغییر وضعیت تیکت #${ticket.number}`,
              body: `وضعیت تیکت به «${ticketStatusLabel(toStatus)}» تغییر کرد.`,
            },
          ]
        : []),
      ...(ticket.assignedToId && ticket.assignedToId !== input.user.id
        ? [
            {
              recipientType: "OPERATOR",
              recipientUserId: ticket.assignedToId,
              ticketId: ticket.id,
              departmentId: ticket.departmentId,
              kind: "TICKET_STATUS_CHANGED",
              title: `تغییر وضعیت تیکت #${ticket.number}`,
              body: `${actorLabel}: ${ticketStatusLabel(fromStatus)} → ${ticketStatusLabel(toStatus)}`,
            },
          ]
        : []),
    ],
  });

  await audit({
    actorType: "USER",
    actorUserId: input.user.id,
    actorLabel: input.user.username,
    action: "ticket.status.changed",
    entityType: "Ticket",
    entityId: ticket.id,
    metadata: { number: ticket.number, from: fromStatus, to: toStatus },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return { ok: true, data: { status: toStatus } };
}

/** Resolve the ticket linked to a resolved conversation (SYSTEM actor). */
export async function resolveTicketsForConversation(conversationId: string): Promise<void> {
  const tickets = await db.ticket.findMany({
    where: { conversationId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } },
    select: { id: true, number: true, status: true, customerId: true, departmentId: true, assignedToId: true },
  });
  for (const ticket of tickets) {
    const result = await applyTransition({
      ticketId: ticket.id,
      fromStatus: ticket.status as TicketStatus,
      toStatus: "RESOLVED",
      actorType: "SYSTEM",
      actorLabel: "پایان گفتگوی زنده",
      note: "گفتگوی زنده مرتبط پایان یافت",
    });
    if (result.ok) {
      if (ticket.customerId) {
        await db.notification.create({
          data: {
            recipientType: "CUSTOMER",
            recipientCustomerId: ticket.customerId,
            ticketId: ticket.id,
            departmentId: ticket.departmentId,
            kind: "TICKET_STATUS_CHANGED",
            title: `تیکت #${ticket.number} حل‌شده`,
            body: "گفتگوی مرتبط با موفقیت پایان یافت.",
          },
        });
      }
      await audit({
        actorType: "SYSTEM",
        action: "ticket.resolved.from_conversation",
        entityType: "Ticket",
        entityId: ticket.id,
        metadata: { number: ticket.number, conversationId },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Assignment / reassignment / transfer
// ---------------------------------------------------------------------------

export async function assignTicket(input: {
  user: StaffActor;
  ticketId: string;
  targetUserId?: string; // "auto" when absent
  meta: RequestMeta;
}): Promise<{ ok: true; data: { assignedToName: string | null } } | ServiceError> {
  const ticket = await db.ticket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, number: true, status: true, assignedToId: true, departmentId: true },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");
  if (!(await hasDepartmentAccess(input.user.id, ticket.departmentId))) {
    return fail(403, "به این تیکت دسترسی ندارید.");
  }
  if (ticket.status === "CLOSED") return fail(409, "تیکت بسته‌شده قابل ارجاع نیست.");

  let assigneeId: string | null = null;
  let mode: AssignmentMode = "MANUAL";
  let auditAction = "ticket.assign.manual";
  let assignmentDescription: string;

  if (input.targetUserId && input.targetUserId !== "auto") {
    const target = await db.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, username: true, name: true, status: true, isAvailable: true },
    });
    if (!target || target.status !== "ACTIVE") return fail(422, "کاربر مقصد فعال نیست.");
    const member = await db.departmentMembership.findFirst({
      where: { userId: target.id, departmentId: ticket.departmentId },
    });
    if (!member) return fail(422, "کاربر مقصد عضو دپارتمان این تیکت نیست.");
    const perms = await getEffectivePermissions(target.id);
    if (!perms.has("tickets.reply")) return fail(422, "کاربر مقصد مجوز پاسخ‌گویی ندارد.");
    assigneeId = target.id;
    assignmentDescription = `${input.user.name || input.user.username} → ${target.name}`;
    if (input.targetUserId === input.user.id) auditAction = "ticket.assign.self";
  } else {
    const decision = await withAssignmentLock(async () => {
      const eligible = await computeEligibleOperators(ticket.departmentId);
      return db.$transaction((tx) => pickAssigneeInTx(tx, ticket.departmentId, eligible));
    });
    if (!decision.assigneeId) {
      return fail(409, "اپراتور واجد شرایطی برای ارجاع خودکار یافت نشد.");
    }
    assigneeId = decision.assigneeId;
    mode = "AUTO_FAIR";
    auditAction = "ticket.assign.auto";
    assignmentDescription = describeDecision(
      decision,
      new Map(decision.candidates.map((c) => [c.userId, c.name] as const))
    );
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { assignedToId: assigneeId, assignedAt: now, assignmentMode: mode, updatedAt: now },
    });
    if (assigneeId) {
      await tx.notification.create({
        data: {
          recipientType: "OPERATOR",
          recipientUserId: assigneeId,
          ticketId: ticket.id,
          departmentId: ticket.departmentId,
          kind: "TICKET_ASSIGNED",
          title: `تیکت #${ticket.number} به شما ارجاع شد`,
          body: `توسط ${input.user.name || input.user.username}`,
        },
      });
    }
  });

  await audit({
    actorType: "USER",
    actorUserId: input.user.id,
    actorLabel: input.user.username,
    action: auditAction,
    entityType: "Ticket",
    entityId: ticket.id,
    metadata: { number: ticket.number, from: ticket.assignedToId, to: assigneeId, decision: assignmentDescription },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  const assignee = assigneeId
    ? await db.user.findUnique({ where: { id: assigneeId }, select: { name: true, username: true } })
    : null;
  return { ok: true, data: { assignedToName: assignee?.name ?? assignee?.username ?? null } };
}

export async function transferTicket(input: {
  user: StaffActor;
  ticketId: string;
  departmentId: string;
  meta: RequestMeta;
}): Promise<{ ok: true; data: { departmentName: string } } | ServiceError> {
  const ticket = await db.ticket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, number: true, subject: true, status: true, assignedToId: true, departmentId: true, customerId: true },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");
  if (!(await hasDepartmentAccess(input.user.id, ticket.departmentId))) {
    return fail(403, "به این تیکت دسترسی ندارید.");
  }
  if (ticket.departmentId === input.departmentId) {
    return fail(422, "دپارتمان مقصد باید متفاوت باشد.");
  }
  const target = await db.department.findUnique({
    where: { id: input.departmentId },
    select: { id: true, name: true, isActive: true },
  });
  if (!target || !target.isActive) return fail(404, "دپارتمان مقصد یافت نشد یا غیرفعال است.");
  if (ticket.status === "CLOSED") return fail(409, "تیکت بسته‌شده قابل انتقال نیست.");

  // Transfer unassigns, then the fair engine reassigns in the new department.
  const decision = await withAssignmentLock(async () => {
  const transferEligible = await computeEligibleOperators(target.id);
  return db.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { departmentId: target.id, assignedToId: null, assignedAt: null, assignmentMode: null, updatedAt: new Date() },
    });
    const d = await pickAssigneeInTx(tx, target.id, transferEligible);
    if (d.assigneeId) {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { assignedToId: d.assigneeId, assignedAt: new Date(), assignmentMode: "TRANSFER" },
      });
      await tx.notification.create({
        data: {
          recipientType: "OPERATOR",
          recipientUserId: d.assigneeId,
          ticketId: ticket.id,
          departmentId: target.id,
          kind: "TICKET_TRANSFERRED",
          title: `تیکت #${ticket.number} از دپارتمان دیگر منتقل شد`,
          body: ticket.subject,
        },
      });
    } else {
      await notifyQueueMembers(
        tx,
        target.id,
        ticket.id,
        "TICKET_UNASSIGNED_QUEUE",
        `تیکت انتقال‌یافته بدون مسئول #${ticket.number}`,
        `${ticket.subject} — از بخش ارجاع، اپراتور تعیین کنید.`
      );
    }
    return d;
  });
  });

  const previousDept = await db.department.findUnique({
    where: { id: ticket.departmentId },
    select: { name: true },
  });

  await audit({
    actorType: "USER",
    actorUserId: input.user.id,
    actorLabel: input.user.username,
    action: "ticket.transferred",
    entityType: "Ticket",
    entityId: ticket.id,
    metadata: {
      number: ticket.number,
      fromDepartmentId: ticket.departmentId,
      toDepartmentId: target.id,
      decision: describeDecision(decision, new Map(decision.candidates.map((c) => [c.userId, c.name] as const))),
    },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return { ok: true, data: { departmentName: target.name } };
}

// ---------------------------------------------------------------------------
// Customer history for operators (tickets.customer.history.view)
// ---------------------------------------------------------------------------

export async function getCustomerHistory(
  actor: StaffActor,
  customerId: string
): Promise<
  | {
      ok: true;
      data: {
        customer: {
          id: string;
          fullName: string;
          maskedNationalId: string;
          status: string;
          createdAt: string;
        };
        tickets: Array<{
          id: string;
          number: number;
          subject: string;
          status: string;
          statusLabel: string;
          departmentName: string;
          createdAt: string;
          resolvedAt: string | null;
        }>;
      };
    }
  | ServiceError
> {
  const profile = await db.customerProfile.findUnique({
    where: { id: customerId },
    include: {
      tickets: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { department: { select: { name: true } } },
      },
    },
  });
  if (!profile) return fail(404, "پروفایل مراجع یافت نشد.");

  const scope = await resolveDepartmentScope(actor.id);
  const nid = decryptNationalId(profile.nationalIdEnc);

  return {
    ok: true,
    data: {
      customer: {
        id: profile.id,
        fullName: profile.fullName,
        maskedNationalId: nid ? maskNationalId(nid) : "••••••••••",
        status: profile.status,
        createdAt: profile.createdAt.toISOString(),
      },
      tickets: profile.tickets
        .filter((t) => scope.all || scope.departmentIds.includes(t.departmentId))
        .map((t) => ({
          id: t.id,
          number: t.number,
          subject: t.subject,
          status: t.status,
          statusLabel: ticketStatusLabel(t.status),
          departmentName: t.department.name,
          createdAt: t.createdAt.toISOString(),
          resolvedAt: t.resolvedAt?.toISOString() ?? null,
        })),
    },
  };
}

// ---------------------------------------------------------------------------
// Conversation ↔ ticket touchpoints (used by the conversations service)
// ---------------------------------------------------------------------------

/**
 * When an operator replies in a linked conversation, keep the linked ticket
 * consistent: self-assign if unassigned, stamp first response, move
 * OPEN/WAITING_CUSTOMER → IN_PROGRESS.
 */
export async function touchTicketForOperatorReply(conversationId: string, userId: string, userLabel: string): Promise<void> {
  const ticket = await db.ticket.findFirst({
    where: { conversationId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } },
    select: { id: true, number: true, status: true, assignedToId: true, firstResponseAt: true },
  });
  if (!ticket) return;
  const now = new Date();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (!ticket.assignedToId) {
    updates.assignedToId = userId;
    updates.assignedAt = now;
    updates.assignmentMode = "SELF";
  }
  if (!ticket.firstResponseAt) updates.firstResponseAt = now;
  if (ticket.status === "OPEN" || ticket.status === "WAITING_CUSTOMER") {
    updates.status = "IN_PROGRESS";
    await db.ticketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: "IN_PROGRESS",
        actorType: "OPERATOR",
        actorId: userId,
        actorLabel: userLabel,
        note: "پاسخ اپراتور در گفتگوی زنده",
      },
    });
  }
  await db.ticket.update({ where: { id: ticket.id }, data: updates });
}

// ---------------------------------------------------------------------------
// Attachment download authorization
// ---------------------------------------------------------------------------

export type AttachmentAuth =
  | { ok: true; filename: string; mimeType: string; storageKey: string; sizeBytes: number }
  | { ok: false; status: number; error: string };

/** Staff download: requires department access to the ticket. */
export async function getStaffAttachment(
  user: StaffActor,
  attachmentId: string
): Promise<AttachmentAuth> {
  const att = await db.ticketAttachment.findUnique({
    where: { id: attachmentId },
    include: { message: { include: { ticket: { select: { departmentId: true } } } } },
  });
  if (!att) return { ok: false, status: 404, error: "پیوست یافت نشد." };
  const allowed = await hasDepartmentAccess(user.id, att.message.ticket.departmentId);
  if (!allowed) return { ok: false, status: 403, error: "دسترسی به این پیوست ندارید." };
  return {
    ok: true,
    filename: att.filename,
    mimeType: att.mimeType,
    storageKey: att.storageKey,
    sizeBytes: att.sizeBytes,
  };
}

/** Customer download: requires ownership of the ticket. */
export async function getCustomerAttachment(
  customerId: string,
  attachmentId: string
): Promise<AttachmentAuth> {
  const att = await db.ticketAttachment.findUnique({
    where: { id: attachmentId },
    include: { message: { include: { ticket: { select: { customerId: true } } } } },
  });
  if (!att || att.message.ticket.customerId !== customerId) {
    return { ok: false, status: 404, error: "پیوست یافت نشد." };
  }
  return {
    ok: true,
    filename: att.filename,
    mimeType: att.mimeType,
    storageKey: att.storageKey,
    sizeBytes: att.sizeBytes,
  };
}

/** Delete a ticket (explicit permission, Phase 4 keeps it available but rare). */
export async function deleteTicketDeep(input: {
  user: StaffActor;
  ticketId: string;
  meta: RequestMeta;
}): Promise<{ ok: true } | ServiceError> {
  const ticket = await db.ticket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, number: true, departmentId: true },
  });
  if (!ticket) return fail(404, "تیکت یافت نشد.");
  if (!(await hasDepartmentAccess(input.user.id, ticket.departmentId))) {
    return fail(403, "به این تیکت دسترسی ندارید.");
  }
  const attachments = await db.ticketAttachment.findMany({
    where: { message: { ticketId: ticket.id } },
    select: { storageKey: true },
  });
  await db.ticket.delete({ where: { id: ticket.id } }); // cascades messages/attachments/history/notifications
  for (const a of attachments) {
    await deleteAttachmentFile(a.storageKey);
  }
  await audit({
    actorType: "USER",
    actorUserId: input.user.id,
    actorLabel: input.user.username,
    action: "ticket.deleted",
    entityType: "Ticket",
    entityId: ticket.id,
    metadata: { number: ticket.number },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });
  return { ok: true };
}


