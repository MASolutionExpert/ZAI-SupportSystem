import "server-only";

import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hashPassword, verifyDummyPassword, verifyPassword } from "@/lib/auth/password";
import { checkRateLimit } from "@/lib/conversations/rate-limit";
import { resolveDepartmentScope, type DepartmentScope } from "@/lib/rbac/scope";
import { ticketStatusLabel } from "@/lib/tickets/types";
import {
  decryptNationalId,
  encryptNationalId,
  maskNationalId,
  nationalIdHmac,
  validateNationalId,
} from "@/lib/customers/identity";

/**
 * Citizen accounts (کاربران سامانه) — Phase 8.
 *
 * Citizens authenticate with کد ملی + password; the password is set at
 * first contact (ticket submission or live-chat identity step). OTP/SMS
 * verification was removed by product decision in Phase 8.
 *
 * Security rules preserved (SECURITY.md §4):
 *  - the raw national ID is never a relational key, never logged, never
 *    displayed in full (masked tail only);
 *  - passwords are bcrypt-hashed; plaintext is never stored or audited;
 *  - login attempts are throttled per IP and per identity (keyed by the
 *    non-reversible HMAC);
 *  - a missing profile performs a dummy bcrypt compare so timing does not
 *    reveal account existence.
 */

const MAX_NAME_CHARS = 80;
const EXCERPT_CHARS = 90;

const LOGIN_LIMIT_PER_IP = 10;
const LOGIN_LIMIT_PER_ID = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const RESOLVE_LIMIT_PER_IP = 20;
const RESOLVE_WINDOW_MS = 15 * 60 * 1000;

export type CitizenStatus = "ACTIVE" | "BLOCKED";
export const CITIZEN_STATUSES: readonly CitizenStatus[] = ["ACTIVE", "BLOCKED"];

// ------------------------------------------------------------- password ----

/**
 * Citizen password policy — deliberately lighter than the staff policy
 * (12+ chars, mixed case) because this is a general-public portal:
 * 8+ characters with at least one Latin letter and one digit.
 */
export function validateCitizenPassword(password: string): { ok: boolean; reason?: string } {
  if (password.length < 8) {
    return { ok: false, reason: "رمز عبور باید حداقل ۸ کاراکتر باشد." };
  }
  if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password)) {
    return { ok: false, reason: "رمز عبور باید شامل حروف لاتین و عدد باشد." };
  }
  return { ok: true };
}

/** Ambiguity-free alphabet for generated reset passwords (no 0/O/1/l/I). */
const GEN_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generate a readable temporary password that satisfies the citizen policy. */
export function generateCitizenPassword(): string {
  const pick = (n: number) =>
    Array.from({ length: n }, () => GEN_ALPHABET[Math.floor(Math.random() * GEN_ALPHABET.length)]).join("");
  return `Sd${pick(6)}-${pick(4)}${Math.floor(10 + Math.random() * 90)}`;
}

// ----------------------------------------------------------------- views ----

export type CitizenView = {
  id: string;
  fullName: string;
  maskedNationalId: string;
  status: CitizenStatus;
  createdAt: string;
};

type ProfileRow = {
  id: string;
  fullName: string;
  nationalIdEnc: string;
  status: string;
  createdAt: Date;
};

export function citizenView(profile: ProfileRow): CitizenView {
  const nid = decryptNationalId(profile.nationalIdEnc) ?? "";
  return {
    id: profile.id,
    fullName: profile.fullName,
    maskedNationalId: nid ? maskNationalId(nid) : "••••••••••",
    status: (CITIZEN_STATUSES as readonly string[]).includes(profile.status)
      ? (profile.status as CitizenStatus)
      : "ACTIVE",
    createdAt: profile.createdAt.toISOString(),
  };
}

function excerpt(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > EXCERPT_CHARS ? `${oneLine.slice(0, EXCERPT_CHARS)}…` : oneLine;
}

// ------------------------------------------------- identity resolution ----

export type ResolveIdentityResult =
  | { ok: true; profile: { id: string; fullName: string }; created: boolean }
  | { ok: false; status: number; error: string };

/**
 * Resolve (register-or-login) a citizen from a submission context — used by
 * BOTH the portal ticket form and the live-chat identity step:
 *  - unknown national ID → validate password → create the account;
 *  - known national ID → verify the password (a legacy profile without a
 *    password sets one now — its first-time set);
 *  - blocked accounts are refused with a stable message.
 */
export async function resolveCitizenIdentity(input: {
  nationalId: string;
  fullName: string;
  password: string;
  via: "PORTAL_TICKET" | "CHAT";
  ip?: string;
  userAgent?: string;
}): Promise<ResolveIdentityResult> {
  const normalized = validateNationalId(input.nationalId ?? "");
  if (!normalized) {
    return { ok: false, status: 422, error: "کد ملی واردشده معتبر نیست." };
  }
  const password = (input.password ?? "").trim();
  if (password.length === 0) {
    return { ok: false, status: 422, error: "رمز عبور را وارد کنید." };
  }

  const fullName = (input.fullName ?? "").trim().slice(0, MAX_NAME_CHARS);
  const hmac = nationalIdHmac(normalized);

  // Bounded attempts per IP (raw ID never keys the limiter).
  if (
    !checkRateLimit(
      `citizen:resolve:${input.via}:${input.ip ?? "unknown"}`,
      RESOLVE_LIMIT_PER_IP,
      RESOLVE_WINDOW_MS
    )
  ) {
    return { ok: false, status: 429, error: "درخواست‌های بیش از حد؛ کمی بعد دوباره تلاش کنید." };
  }

  const profile = await db.customerProfile.findUnique({ where: { nationalIdHmac: hmac } });

  if (!profile) {
    // Registration — password becomes the account password (first-time set).
    if (fullName.length < 3) {
      return { ok: false, status: 422, error: "نام و نام خانوادگی را کامل وارد کنید." };
    }
    const strength = validateCitizenPassword(password);
    if (!strength.ok) {
      return { ok: false, status: 422, error: strength.reason ?? "رمز عبور نامعتبر است." };
    }
    // Timing equalization against the login path.
    await verifyDummyPassword();

    const created = await db.customerProfile
      .create({
        data: {
          fullName,
          nationalIdEnc: encryptNationalId(normalized),
          nationalIdHmac: hmac,
          passwordHash: await hashPassword(password),
          lastLoginAt: new Date(),
        },
      })
      .catch(async (error) => {
        // Parallel first-contact race (P2002): fall back to the winner's row
        // and continue through the login path below.
        if ((error as { code?: string } | null)?.code !== "P2002") throw error;
        const winner = await db.customerProfile.findUnique({ where: { nationalIdHmac: hmac } });
        if (!winner) throw error;
        return winner;
      });

    await audit({
      actorType: "CUSTOMER",
      actorLabel: created.fullName,
      action: "citizen.account.registered",
      entityType: "CustomerProfile",
      entityId: created.id,
      metadata: { via: input.via },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    // Lost the creation race → fall through to password verification.
    if (created.nationalIdHmac !== hmac || created.passwordHash === null) {
      const verified = created.passwordHash
        ? await verifyPassword(password, created.passwordHash)
        : false;
      if (!verified) {
        return { ok: false, status: 401, error: "کد ملی یا رمز عبور نادرست است." };
      }
    }

    return { ok: true, profile: { id: created.id, fullName: created.fullName }, created: true };
  }

  if (profile.status === "BLOCKED") {
    return {
      ok: false,
      status: 403,
      error: "حساب شما توسط مدیر سامانه مسدود شده است؛ با پشتیبانی تماس بگیرید.",
    };
  }

  let passwordOk = false;
  let firstTimeSet = false;
  if (!profile.passwordHash) {
    // Legacy profile (pre-Phase 8 row): this contact sets the first password.
    const strength = validateCitizenPassword(password);
    if (!strength.ok) {
      return { ok: false, status: 422, error: strength.reason ?? "رمز عبور نامعتبر است." };
    }
    const hash = await hashPassword(password);
    await db.customerProfile.update({
      where: { id: profile.id },
      data: { passwordHash: hash, mustChangePassword: false },
    });
    passwordOk = true;
    firstTimeSet = true;
  } else {
    passwordOk = await verifyPassword(password, profile.passwordHash);
  }

  if (!passwordOk) {
    await audit({
      actorType: "CUSTOMER",
      actorLabel: profile.fullName,
      action: "citizen.login.failed",
      entityType: "CustomerProfile",
      entityId: profile.id,
      metadata: { via: input.via },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ok: false, status: 401, error: "کد ملی یا رمز عبور نادرست است." };
  }

  // Submissions may refine the stored display name (login does not).
  const nameChanged = fullName.length >= 3 && fullName !== profile.fullName;
  const updated = await db.customerProfile.update({
    where: { id: profile.id },
    data: {
      ...(nameChanged ? { fullName } : {}),
      lastLoginAt: new Date(),
    },
  });

  if (firstTimeSet) {
    await audit({
      actorType: "CUSTOMER",
      actorLabel: updated.fullName,
      action: "citizen.password.initial_set",
      entityType: "CustomerProfile",
      entityId: profile.id,
      metadata: { via: input.via },
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
  await audit({
    actorType: "CUSTOMER",
    actorLabel: updated.fullName,
    action: "citizen.login.succeeded",
    entityType: "CustomerProfile",
    entityId: profile.id,
    metadata: { via: input.via, nameChanged },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true, profile: { id: updated.id, fullName: updated.fullName }, created: false };
}

/**
 * Portal login (پیگیری) — کد ملی + password only; never mutates the name.
 */
export async function authenticateCitizen(input: {
  nationalId: string;
  password: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; profile: CitizenView } | { ok: false; status: number; error: string }> {
  const normalized = validateNationalId(input.nationalId ?? "");
  if (!normalized || (input.password ?? "").trim().length === 0) {
    return { ok: false, status: 422, error: "کد ملی یا رمز عبور را وارد کنید." };
  }

  const hmac = nationalIdHmac(normalized);
  if (
    !checkRateLimit(`citizen:login:ip:${input.ip ?? "unknown"}`, LOGIN_LIMIT_PER_IP, LOGIN_WINDOW_MS)
  ) {
    return { ok: false, status: 429, error: "تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید." };
  }
  if (
    !checkRateLimit(`citizen:login:id:${hmac}`, LOGIN_LIMIT_PER_ID, LOGIN_WINDOW_MS)
  ) {
    return { ok: false, status: 429, error: "تلاش‌های بیش از حد برای این کد ملی؛ کمی بعد تلاش کنید." };
  }

  const profile = await db.customerProfile.findUnique({ where: { nationalIdHmac: hmac } });
  if (!profile || !profile.passwordHash) {
    // Dummy compare keeps timing uniform whether or not the account exists.
    await verifyDummyPassword();
    return { ok: false, status: 401, error: "کد ملی یا رمز عبور نادرست است." };
  }

  const passwordOk = await verifyPassword(input.password.trim(), profile.passwordHash);
  if (!passwordOk || profile.status === "BLOCKED") {
    await audit({
      actorType: "CUSTOMER",
      actorLabel: profile.fullName,
      action: profile.status === "BLOCKED" ? "citizen.login.blocked" : "citizen.login.failed",
      entityType: "CustomerProfile",
      entityId: profile.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return {
      ok: false,
      status: profile.status === "BLOCKED" ? 403 : 401,
      error:
        profile.status === "BLOCKED"
          ? "حساب شما توسط مدیر سامانه مسدود شده است؛ با پشتیبانی تماس بگیرید."
          : "کد ملی یا رمز عبور نادرست است.",
    };
  }

  const updated = await db.customerProfile.update({
    where: { id: profile.id },
    data: { lastLoginAt: new Date() },
  });

  await audit({
    actorType: "CUSTOMER",
    actorLabel: updated.fullName,
    action: "citizen.login.succeeded",
    entityType: "CustomerProfile",
    entityId: profile.id,
    metadata: { via: "PORTAL_LOGIN" },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true, profile: citizenView(updated) };
}

/** Portal self-service password change (requires the current password). */
export async function changeCitizenPassword(input: {
  customerId: string;
  currentPassword: string;
  newPassword: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const profile = await db.customerProfile.findUnique({ where: { id: input.customerId } });
  if (!profile || !profile.passwordHash) {
    return { ok: false, status: 404, error: "حساب یافت نشد." };
  }
  if (profile.status === "BLOCKED") {
    return { ok: false, status: 403, error: "حساب شما مسدود شده است؛ با پشتیبانی تماس بگیرید." };
  }

  const currentOk = await verifyPassword(input.currentPassword ?? "", profile.passwordHash);
  if (!currentOk) {
    return { ok: false, status: 401, error: "رمز عبور فعلی نادرست است." };
  }
  const strength = validateCitizenPassword(input.newPassword ?? "");
  if (!strength.ok) {
    return { ok: false, status: 422, error: strength.reason ?? "رمز عبور نامعتبر است." };
  }
  if (await verifyPassword(input.newPassword, profile.passwordHash)) {
    return { ok: false, status: 422, error: "رمز جدید باید با رمز فعلی متفاوت باشد." };
  }

  await db.customerProfile.update({
    where: { id: profile.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
  });

  await audit({
    actorType: "CUSTOMER",
    actorLabel: profile.fullName,
    action: "citizen.password.changed_self",
    entityType: "CustomerProfile",
    entityId: profile.id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  return { ok: true };
}

// --------------------------------------------------------- admin manage ----

export type CitizenAdminListItem = CitizenView & {
  ticketCount: number;
  conversationCount: number;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

export async function listCitizensForAdmin(opts?: {
  query?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  citizens: CitizenAdminListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, Math.min(500, Math.floor(opts?.page ?? 1)));
  const pageSize = Math.max(1, Math.min(100, Math.floor(opts?.pageSize ?? 20)));

  const query = (opts?.query ?? "").trim();
  let where: { status?: string; nationalIdHmac?: string; fullName?: { contains: string; mode: "insensitive" } } = {};
  if (opts?.status && (CITIZEN_STATUSES as readonly string[]).includes(opts.status)) {
    where.status = opts.status;
  }
  if (query) {
    // A valid national-ID query hits the HMAC index directly; anything else
    // is a name-substring search. The raw value is never stored/logged.
    const normalized = validateNationalId(query);
    if (normalized) {
      where = { ...where, nationalIdHmac: nationalIdHmac(normalized) };
    } else {
      where = { ...where, fullName: { contains: query, mode: "insensitive" } };
    }
  }

  const [total, rows] = await Promise.all([
    db.customerProfile.count({ where }),
    db.customerProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        fullName: true,
        nationalIdEnc: true,
        status: true,
        passwordHash: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { tickets: true, conversations: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    citizens: rows.map((r) => ({
      ...citizenView(r),
      ticketCount: r._count.tickets,
      conversationCount: r._count.conversations,
      hasPassword: r.passwordHash !== null,
      mustChangePassword: r.mustChangePassword,
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    })),
  };
}

export type CitizenAdminDetail = CitizenAdminListItem & {
  tickets: Array<{
    id: string;
    number: number;
    subject: string;
    status: string;
    statusLabel: string;
    departmentName: string;
    createdAt: string;
    updatedAt: string;
  }>;
  conversations: Array<{
    id: string;
    mode: string;
    modeLabel?: string;
    departmentName: string;
    messageCount: number;
    lastMessageAt: string;
  }>;
};

export async function getCitizenForAdmin(id: string): Promise<CitizenAdminDetail | null> {
  const profile = await db.customerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      nationalIdEnc: true,
      status: true,
      passwordHash: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { tickets: true, conversations: true } },
      tickets: {
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          number: true,
          subject: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          department: { select: { name: true } },
        },
      },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 20,
        select: {
          id: true,
          mode: true,
          lastMessageAt: true,
          department: { select: { name: true } },
          _count: { select: { messages: true } },
        },
      },
    },
  });
  if (!profile) return null;

  return {
    ...citizenView(profile),
    ticketCount: profile._count.tickets,
    conversationCount: profile._count.conversations,
    hasPassword: profile.passwordHash !== null,
    mustChangePassword: profile.mustChangePassword,
    lastLoginAt: profile.lastLoginAt ? profile.lastLoginAt.toISOString() : null,
    tickets: profile.tickets.map((t) => ({
      id: t.id,
      number: t.number,
      subject: t.subject,
      status: t.status,
      statusLabel: ticketStatusLabel(t.status),
      departmentName: t.department.name,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
    conversations: profile.conversations.map((c) => ({
      id: c.id,
      mode: c.mode,
      departmentName: c.department.name,
      messageCount: c._count.messages,
      lastMessageAt: c.lastMessageAt.toISOString(),
    })),
  };
}

export type AdminCitizenMutationResult =
  | { ok: true; citizen: CitizenView | null }
  | { ok: false; status: number; error: string };

export async function updateCitizenByAdmin(input: {
  actorId: string;
  actorLabel: string;
  citizenId: string;
  fullName?: string;
  status?: string;
}): Promise<AdminCitizenMutationResult> {
  const profile = await db.customerProfile.findUnique({ where: { id: input.citizenId } });
  if (!profile) return { ok: false, status: 404, error: "کاربر یافت نشد." };

  const data: { fullName?: string; status?: string } = {};
  if (input.fullName !== undefined) {
    const name = input.fullName.trim().slice(0, MAX_NAME_CHARS);
    if (name.length < 3) {
      return { ok: false, status: 422, error: "نام و نام خانوادگی را کامل وارد کنید." };
    }
    data.fullName = name;
  }
  if (input.status !== undefined) {
    if (!(CITIZEN_STATUSES as readonly string[]).includes(input.status)) {
      return { ok: false, status: 422, error: "وضعیت نامعتبر است." };
    }
    data.status = input.status;
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, status: 422, error: "تغییری برای اعمال وجود ندارد." };
  }

  const updated = await db.customerProfile.update({ where: { id: profile.id }, data });

  await audit({
    actorType: "USER",
    actorUserId: input.actorId,
    actorLabel: input.actorLabel,
    action: "admin.citizen.updated",
    entityType: "CustomerProfile",
    entityId: profile.id,
    metadata: { changes: Object.keys(data) },
  });

  return { ok: true, citizen: citizenView(updated) };
}

/**
 * Superadmin password reset — the generated/set plaintext is returned ONCE
 * (response only; never persisted, never audited). The citizen sees a
 * must-change hint in the portal until they replace it themselves.
 */
export async function resetCitizenPasswordByAdmin(input: {
  actorId: string;
  actorLabel: string;
  citizenId: string;
  password?: string;
}): Promise<{ ok: true; password: string } | { ok: false; status: number; error: string }> {
  const profile = await db.customerProfile.findUnique({ where: { id: input.citizenId } });
  if (!profile) return { ok: false, status: 404, error: "کاربر یافت نشد." };

  const plaintext = (input.password ?? "").trim() || generateCitizenPassword();
  const strength = validateCitizenPassword(plaintext);
  if (!strength.ok) {
    return { ok: false, status: 422, error: strength.reason ?? "رمز عبور نامعتبر است." };
  }

  await db.customerProfile.update({
    where: { id: profile.id },
    data: { passwordHash: await hashPassword(plaintext), mustChangePassword: true },
  });

  await audit({
    actorType: "USER",
    actorUserId: input.actorId,
    actorLabel: input.actorLabel,
    action: "admin.citizen.password_reset",
    entityType: "CustomerProfile",
    entityId: profile.id,
    metadata: { generated: !input.password },
  });

  return { ok: true, password: plaintext };
}

export async function deleteCitizenByAdmin(input: {
  actorId: string;
  actorLabel: string;
  citizenId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const profile = await db.customerProfile.findUnique({
    where: { id: input.citizenId },
    include: { _count: { select: { tickets: true } } },
  });
  if (!profile) return { ok: false, status: 404, error: "کاربر یافت نشد." };

  await db.customerProfile.delete({ where: { id: profile.id } });

  await audit({
    actorType: "USER",
    actorUserId: input.actorId,
    actorLabel: input.actorLabel,
    action: "admin.citizen.deleted",
    entityType: "CustomerProfile",
    entityId: profile.id,
    metadata: {
      fullName: profile.fullName,
      ticketCount: profile._count.tickets,
      note: "تیکت‌ها و گفتگوها بدون اتصال به کاربر حفظ شدند.",
    },
  });

  return { ok: true };
}

// ---------------------------------------------------- staff (operators) ----

export type CitizenThreadSummary = {
  id: string;
  fullName: string;
  maskedNationalId: string;
  ticketCount: number;
  lastActivityAt: string;
  lastExcerpt: string | null;
};

/**
 * Citizen-centric thread list for the support desk: every citizen with at
 * least one ticket or live conversation inside the operator's department
 * scope, with the most recent message excerpt (the "last messages" view).
 */
export async function listCitizenThreadsForStaff(
  user: { id: string },
  opts?: { query?: string; limit?: number }
): Promise<{ citizens: CitizenThreadSummary[] }> {
  const scope = await resolveDepartmentScope(user.id);
  const departmentFilter = scope.all ? {} : { departmentId: { in: scope.departmentIds } };
  const limit = Math.max(1, Math.min(100, Math.floor(opts?.limit ?? 60)));

  const [tickets, conversations] = await Promise.all([
    db.ticket.findMany({
      where: { ...departmentFilter, customerId: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: { customerId: true, updatedAt: true },
    }),
    db.conversation.findMany({
      where: { ...departmentFilter, customerId: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      take: 300,
      select: {
        customerId: true,
        lastMessageAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true, content: true },
        },
      },
    }),
  ]);

  type Activity = { at: Date; excerpt: string | null };
  const byCitizen = new Map<string, { ticketCount: number; last: Activity }>();

  const touch = (cid: string, at: Date, excerptValue: string | null) => {
    const existing = byCitizen.get(cid);
    if (!existing) {
      byCitizen.set(cid, { ticketCount: 0, last: { at, excerpt: excerptValue } });
      return;
    }
    if (at.getTime() > existing.last.at.getTime()) {
      existing.last = { at, excerpt: excerptValue };
    }
  };

  for (const t of tickets) {
    if (!t.customerId) continue;
    const entry = byCitizen.get(t.customerId);
    if (entry) entry.ticketCount += 1;
    else byCitizen.set(t.customerId, { ticketCount: 1, last: { at: t.updatedAt, excerpt: null } });
  }
  for (const c of conversations) {
    if (!c.customerId) continue;
    const msg = c.messages[0];
    touch(c.customerId, c.lastMessageAt, msg ? excerpt(msg.content) : null);
  }

  let ids = [...byCitizen.keys()];
  const query = (opts?.query ?? "").trim();
  if (query) {
    const normalized = validateNationalId(query);
    if (normalized) {
      const hit = await db.customerProfile.findUnique({
        where: { nationalIdHmac: nationalIdHmac(normalized) },
        select: { id: true },
      });
      ids = hit && ids.includes(hit.id) ? [hit.id] : [];
    }
  }

  if (ids.length === 0) return { citizens: [] };

  const profiles = await db.customerProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, nationalIdEnc: true },
  });
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const citizens: CitizenThreadSummary[] = [];
  const isNameQuery = query.length > 0 && validateNationalId(query) === null;
  for (const [cid, activity] of byCitizen) {
    const profile = profileMap.get(cid);
    if (!profile) continue;
    if (isNameQuery && !profile.fullName.includes(query)) continue;
    const nid = decryptNationalId(profile.nationalIdEnc) ?? "";
    citizens.push({
      id: cid,
      fullName: profile.fullName,
      maskedNationalId: nid ? maskNationalId(nid) : "••••••••••",
      ticketCount: activity.ticketCount,
      lastActivityAt: activity.last.at.toISOString(),
      lastExcerpt: activity.last.excerpt,
    });
  }

  citizens.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return { citizens: citizens.slice(0, limit) };
}

export type CitizenThreadDetail = {
  citizen: { id: string; fullName: string; maskedNationalId: string; createdAt: string };
  tickets: Array<{
    id: string;
    number: number;
    subject: string;
    statusLabel: string;
    departmentName: string;
    updatedAt: string;
  }>;
  messages: Array<{
    id: string;
    kind: "TICKET" | "CHAT";
    ref: string; // ticket number or conversation label
    authorType: "CUSTOMER" | "OPERATOR" | "SYSTEM" | "ASSISTANT";
    authorLabel: string | null;
    content: string;
    createdAt: string;
  }>;
};

/**
 * Unified citizen thread — the citizen's tickets (in scope) plus their live
 * conversation messages (in scope), newest first. Server-side department
 * scoping ALWAYS applies; the raw national ID never leaves the server.
 */
export async function getCitizenThreadForStaff(
  user: { id: string },
  citizenId: string
): Promise<CitizenThreadDetail | null> {
  const scope: DepartmentScope = await resolveDepartmentScope(user.id);
  const departmentFilter = scope.all ? {} : { departmentId: { in: scope.departmentIds } };

  const profile = await db.customerProfile.findUnique({
    where: { id: citizenId },
    select: { id: true, fullName: true, nationalIdEnc: true, createdAt: true },
  });
  if (!profile) return null;

  const [tickets, conversations] = await Promise.all([
    db.ticket.findMany({
      where: { ...departmentFilter, customerId: citizenId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        number: true,
        subject: true,
        status: true,
        updatedAt: true,
        department: { select: { name: true } },
      },
    }),
    db.conversation.findMany({
      where: { ...departmentFilter, customerId: citizenId },
      orderBy: { lastMessageAt: "desc" },
      take: 10,
      select: {
        id: true,
        mode: true,
        department: { select: { name: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 40,
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    }),
  ]);

  const messages: CitizenThreadDetail["messages"] = [];
  for (const t of tickets) {
    const ticketMessages = await db.ticketMessage.findMany({
      where: { ticketId: t.id, isInternalNote: false },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        authorType: true,
        authorLabel: true,
        content: true,
        createdAt: true,
      },
    });
    for (const m of ticketMessages) {
      messages.push({
        id: m.id,
        kind: "TICKET",
        ref: `#${t.number}`,
        authorType: m.authorType as "CUSTOMER" | "OPERATOR" | "SYSTEM",
        authorLabel: m.authorLabel,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      });
    }
  }
  for (const c of conversations) {
    for (const m of c.messages) {
      messages.push({
        id: m.id,
        kind: "CHAT",
        ref: c.department.name,
        authorType: m.role as "CUSTOMER" | "OPERATOR" | "SYSTEM" | "ASSISTANT",
        authorLabel: null,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      });
    }
  }
  messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const nid = decryptNationalId(profile.nationalIdEnc) ?? "";
  return {
    citizen: {
      id: profile.id,
      fullName: profile.fullName,
      maskedNationalId: nid ? maskNationalId(nid) : "••••••••••",
      createdAt: profile.createdAt.toISOString(),
    },
    tickets: tickets.map((t) => ({
      id: t.id,
      number: t.number,
      subject: t.subject,
      statusLabel: ticketStatusLabel(t.status),
      departmentName: t.department.name,
      updatedAt: t.updatedAt.toISOString(),
    })),
    messages: messages.slice(0, 60),
  };
}
