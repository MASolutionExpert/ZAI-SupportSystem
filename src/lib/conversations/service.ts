import "server-only";

import { randomBytes } from "crypto";

import { audit } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/conversations/rate-limit";
import { resolveCitizenIdentity } from "@/lib/customers/accounts";
import { decryptNationalId, maskNationalId } from "@/lib/customers/identity";
import {
  CONVERSATION_MODE_LABELS,
  type ConversationMode,
  type MessageRole,
  type TranscriptMessage,
} from "@/lib/conversations/types";
import { AiDisabledError, sanitizeSecrets } from "@/lib/ai/adapter";
import { answer as ragAnswer } from "@/lib/rag/engine";
import type { RagResult } from "@/lib/rag/types";
import type { RetrievalResult } from "@/lib/kb/types";
import { normalizePersian } from "@/lib/kb/text";
import {
  LIMIT_REACHED_MESSAGE,
  PROVIDER_UNAVAILABLE_MESSAGE,
  STANDARD_FALLBACK_MESSAGE,
  getDepartmentAiSettings,
} from "@/lib/ai/departments";
import {
  getAiGlobalSettings,
  isAiGloballyEnabled,
  resolveChatModel,
} from "@/lib/ai/settings";
import type { AiGlobalSettings } from "@/lib/ai/types";
import { hasDepartmentAccess, resolveDepartmentScope } from "@/lib/rbac/scope";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import {
  createHandoffTicket,
  resolveTicketsForConversation,
  touchTicketForOperatorReply,
} from "@/lib/tickets/service";

/**
 * Conversation pipeline (Phase 3) — strict knowledge-grounded RAG + state
 * machine for customer↔assistant↔operator conversations (AI-ARCHITECTURE §4).
 *
 * All service functions return discriminated unions so the API layer can map
 * them 1:1 onto the uniform JSON envelope without throwing for expected
 * outcomes. Unexpected failures (DB, bugs) still throw and surface as 500s.
 *
 * Hard rules enforced here (spec §3):
 *  - retrieval ALWAYS runs before any provider call;
 *  - answers are grounded only in retrieved knowledge (prompt-enforced);
 *  - abstention → mandated Persian fallback, never a free-generation answer;
 *  - customer messages are always persisted, even on abstain/failure paths.
 */

// ------------------------------------------------------------------- limits --

const RATE_LIMIT_CONVERSATIONS_PER_HOUR = 10;
const RATE_LIMIT_CONVERSATIONS_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MESSAGES_LIMIT = 20;
const RATE_LIMIT_MESSAGES_WINDOW_MS = 5 * 60 * 1000;

const MIN_MESSAGE_CHARS = 2;
const MAX_MESSAGE_CHARS = 2000;
const MAX_CUSTOMER_NAME_CHARS = 80;
const HISTORY_MESSAGE_COUNT = 8;
const STAFF_LIST_SIZE = 50;
const EXCERPT_CHARS = 80;

// ------------------------------------------------------------- user strings --

const ERR_DEPARTMENT_NOT_ACCEPTING = "این دپارتمان در حال حاضر پذیرش ندارد.";
const ERR_CONVERSATION_NOT_FOUND = "گفتگو یافت نشد.";
const ERR_CONVERSATION_RESOLVED = "این گفتگو پایان یافته است؛ برای ادامه، گفتگوی جدیدی آغاز کنید.";
const ERR_RATE_LIMIT_CREATE = "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.";
const ERR_RATE_LIMIT_MESSAGE = "تعداد پیام‌ها بیش از حد مجاز است؛ لطفاً کمی صبر کنید.";
const ERR_INVALID_CONTENT = "متن پیام باید بین ۲ تا ۲۰۰۰ نویسه باشد.";
const ERR_NO_DEPARTMENT_ACCESS = "دسترسی به این دپارتمان ندارید.";

const WELCOME_AI_MODE =
  "سلام! من دستیار هوشمند این دپارتمان هستم. پرسش خود را بنویسید؛ پاسخ‌ها فقط بر اساس دانش تأییدشده سازمان داده می‌شود.";
const WELCOME_OPERATOR_MODE =
  "سلام! پیام شما ثبت شد و در صف اپراتورهای این دپارتمان قرار گرفت. به‌محض پاسخ‌گویی اپراتور، همین گفتگو ادامه می‌یابد.";
const HANDOFF_REQUESTED_MESSAGE =
  "درخواست شما برای گفتگو با اپراتور ثبت شد و در صف دپارتمان قرار گرفت. اپراتور همین گفتگو را ادامه می‌دهد.";
const RESOLVED_MESSAGE =
  "گفتگو با موفقیت پایان یافت. برای سؤالات بعدی می‌توانید گفتگوی جدیدی آغاز کنید.";

const DEFAULT_ORG_NAME = "سامانه پشتیبانی سازمان";
const GUEST_LABEL = "مهمان";

// -------------------------------------------------------------------- types --

/** Uniform service outcome — the API layer maps this onto the JSON envelope. */
export type Svc<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type RequestMeta = { ip?: string | null; userAgent?: string | null };

/** Minimal staff-actor shape (satisfied by the session user). */
export type StaffActor = { id: string; username: string };

export type StaffConversationSummary = {
  id: string;
  mode: ConversationMode;
  modeLabel: string;
  departmentId: string;
  departmentName: string;
  customerName: string | null;
  /** Phase 8 — masked national ID when the conversation belongs to a citizen account. */
  customerNationalIdMasked: string | null;
  messageCount: number;
  lastMessageAt: string;
  lastMessageExcerpt: string | null;
  assignedToName: string | null;
  /** Phase 4 linkage — the tracked ticket created for the handoff, if any. */
  linkedTicketNumber: number | null;
};

export type CreateConversationResult = {
  token: string;
  mode: ConversationMode;
  departmentName: string;
  welcomeAt: string;
};

export type CustomerConversationView = {
  mode: ConversationMode;
  modeLabel: string;
  departmentName: string;
  aiEnabled: boolean;
  escalatedOfferAvailable: boolean;
  messages: TranscriptMessage[];
};

export type CustomerTurnResult = {
  userMessage: TranscriptMessage;
  assistantMessage: TranscriptMessage | null;
  escalatedOffer: boolean;
  mode: ConversationMode;
};

// ------------------------------------------------------------------ helpers --

function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

function asConversationMode(value: string): ConversationMode {
  return (CONVERSATION_MODE_LABELS as Record<string, string>)[value] !== undefined
    ? (value as ConversationMode)
    : "AI_ASSISTED";
}

function asMessageRole(value: string): MessageRole {
  const roles: readonly string[] = ["CUSTOMER", "ASSISTANT", "OPERATOR", "SYSTEM"];
  return (roles as readonly string[]).includes(value) ? (value as MessageRole) : "SYSTEM";
}

function toTranscript(message: {
  id: string;
  role: string;
  content: string;
  sourcesCount: number | null;
  createdAt: Date;
}): TranscriptMessage {
  return {
    id: message.id,
    role: asMessageRole(message.role),
    content: message.content,
    sourcesCount: message.sourcesCount,
    createdAt: message.createdAt.toISOString(),
  };
}

function modeLabel(mode: ConversationMode): string {
  return CONVERSATION_MODE_LABELS[mode];
}

/** Local midnight — the daily AI usage window (spec §4). */
function startOfToday(): Date {
  return new Date(new Date().setHours(0, 0, 0, 0));
}

async function resolveOrgName(): Promise<string> {
  const value = await getSetting<unknown>(SETTING_KEYS.ORG_NAME);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : DEFAULT_ORG_NAME;
}

/**
 * Model name for usage-log rows on paths that never call the provider
 * (abstain / limit / disabled). `resolveChatModel` throws on an
 * openai-compatible configuration without a model — degrade to a placeholder
 * instead of failing observability.
 */
async function safeModelName(settings: AiGlobalSettings): Promise<string> {
  try {
    return await resolveChatModel(settings);
  } catch {
    return settings.chatModel.trim() || "-";
  }
}

/** Usage logs are observability — a failed insert must never break the turn. */
async function logUsage(entry: {
  conversationId?: string | null;
  departmentId?: string | null;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  outcome: string;
}): Promise<void> {
  try {
    await db.aiUsageLog.create({
      data: {
        conversationId: entry.conversationId ?? null,
        departmentId: entry.departmentId ?? null,
        provider: entry.provider,
        model: entry.model,
        promptTokens: entry.promptTokens ?? 0,
        completionTokens: entry.completionTokens ?? 0,
        latencyMs: entry.latencyMs ?? 0,
        outcome: entry.outcome,
      },
    });
  } catch (error) {
    console.error("[conversations] failed to persist AI usage log:", error);
  }
}

/** Retrieval records power audit + quality review — same never-break rule. */
async function logRetrieval(entry: {
  conversationId: string;
  departmentId: string;
  queryText: string;
  decision: string;
  topScore?: number | null;
  sources?: RetrievalResult["sources"] | null;
}): Promise<void> {
  try {
    await db.knowledgeRetrievalRecord.create({
      data: {
        conversationId: entry.conversationId,
        departmentId: entry.departmentId,
        queryDigest: sha256Hex(normalizePersian(entry.queryText)),
        queryText: entry.queryText,
        decision: entry.decision,
        topScore: entry.topScore ?? null,
        sources:
          entry.sources && entry.sources.length > 0
            ? JSON.stringify(
                entry.sources.map((s) => ({ kind: s.kind, refId: s.refId, title: s.title, score: s.score }))
              )
            : null,
      },
    });
  } catch (error) {
    console.error("[conversations] failed to persist retrieval record:", error);
  }
}

/** Last N non-SYSTEM messages (chronological), excluding the current turn. */
async function loadRecentHistory(
  conversationId: string,
  excludeMessageId: string
): Promise<TranscriptMessage[]> {
  const rows = await db.conversationMessage.findMany({
    where: {
      conversationId,
      id: { not: excludeMessageId },
      role: { not: "SYSTEM" },
    },
    orderBy: { createdAt: "desc" },
    take: HISTORY_MESSAGE_COUNT,
  });
  return rows.reverse().map(toTranscript);
}

// ----------------------------------------------------------- prompt building --

// ------------------------------------------------------- assistant turn (AI) --

type ConversationWithDepartment = {
  id: string;
  departmentId: string;
  mode: string;
  department: { id: string; name: string; aiEnabled: boolean };
};

/**
 * One grounded assistant turn. Retrieval happens FIRST (spec §3 rule); the
 * provider is only called on the ANSWERED path, with one bounded retry.
 * Never fabricates: every non-ANSWERED path produces a mandated Persian text.
 */
async function runAssistantTurn(
  conversation: ConversationWithDepartment,
  question: string,
  userMessage: TranscriptMessage,
  meta: RequestMeta
): Promise<Svc<CustomerTurnResult>> {
  const [dept, globalSettings] = await Promise.all([
    getDepartmentAiSettings(conversation.departmentId),
    getAiGlobalSettings(),
  ]);

  const disabled = !globalSettings.enabled || !dept.aiEnabled;

  // Defensive path — AI switched off between message creation and the turn.
  if (disabled) {
    const assistant = await db.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: STANDARD_FALLBACK_MESSAGE,
        sourcesCount: 0,
      },
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: assistant.createdAt },
    });
    await logRetrieval({
      conversationId: conversation.id,
      departmentId: conversation.departmentId,
      queryText: question,
      decision: "ABSTAINED_DISABLED",
    });
    await logUsage({
      conversationId: conversation.id,
      departmentId: conversation.departmentId,
      provider: globalSettings.providerType,
      model: await safeModelName(globalSettings),
      outcome: "ABSTAINED",
    });
    return {
      ok: true,
      data: {
        userMessage,
        assistantMessage: toTranscript(assistant),
        escalatedOffer: dept.escalationOffer,
        mode: asConversationMode(conversation.mode),
      },
    };
  }

  // Daily usage limit — enforced BEFORE any retrieval or provider call
  // (cost control: an over-limit turn costs nothing).
  const usedToday = await db.aiUsageLog.count({
    where: { departmentId: conversation.departmentId, createdAt: { gte: startOfToday() } },
  });
  if (dept.dailyMessageLimit != null && usedToday >= dept.dailyMessageLimit) {
    const assistant = await db.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: LIMIT_REACHED_MESSAGE,
        sourcesCount: 0,
      },
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: assistant.createdAt },
    });
    await logRetrieval({
      conversationId: conversation.id,
      departmentId: conversation.departmentId,
      queryText: question,
      decision: "ABSTAINED_LIMIT",
    });
    await logUsage({
      conversationId: conversation.id,
      departmentId: conversation.departmentId,
      provider: globalSettings.providerType,
      model: await safeModelName(globalSettings),
      outcome: "ABSTAINED",
    });
    return {
      ok: true,
      data: {
        userMessage,
        assistantMessage: toTranscript(assistant),
        escalatedOffer: dept.escalationOffer,
        mode: asConversationMode(conversation.mode),
      },
    };
  }

  // ---- RAG engine turn (adaptive retrieval + CRAG + grounded generation +
  // verification). The engine persists RagTrace + the legacy retrieval record
  // internally; outcome mapping below keeps the conversation contract.
  const [history] = await Promise.all([
    loadRecentHistory(conversation.id, userMessage.id),
  ]);

  let rag: RagResult | null = null;
  const engineStarted = Date.now();
  try {
    rag = await ragAnswer({
      scope: { departmentId: conversation.departmentId },
      departmentName: conversation.department.name,
      question,
      history,
      minConfidence: dept.minConfidence,
      escalationOffer: dept.escalationOffer,
      conversationId: conversation.id,
    });
  } catch (error) {
    // Kill switch flipped mid-turn → provider-unavailable path below.
    if (!(error instanceof AiDisabledError)) throw error;
    rag = null;
  }
  const engineElapsed = Date.now() - engineStarted;

  if (!rag) {
    const assistant = await db.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: PROVIDER_UNAVAILABLE_MESSAGE,
        sourcesCount: 0,
      },
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: assistant.createdAt },
    });
    await logRetrieval({
      conversationId: conversation.id,
      departmentId: conversation.departmentId,
      queryText: question,
      decision: "ABSTAINED_PROVIDER",
    });
    await logUsage({
      conversationId: conversation.id,
      departmentId: conversation.departmentId,
      provider: globalSettings.providerType,
      model: await safeModelName(globalSettings),
      latencyMs: engineElapsed,
      outcome: "ERROR",
    });
    return {
      ok: true,
      data: {
        userMessage,
        assistantMessage: toTranscript(assistant),
        escalatedOffer: dept.escalationOffer,
        mode: asConversationMode(conversation.mode),
      },
    };
  }

  // Outcome mapping (task §9): ANSWERED / CLARIFY / ABSTAIN — ESCALATE stays
  // an explicit customer action through the existing handoff flow, which
  // preserves the full transcript into the ticket workflow.
  const assistantContent = rag.answerText;
  const sourcesCount = rag.status === "ANSWERED" ? rag.citations.length : 0;
  const escalatedOffer =
    rag.status === "ANSWERED"
      ? false
      : rag.status === "CLARIFY"
        ? dept.escalationOffer
        : dept.escalationOffer && rag.escalationRecommended;

  const assistant = await db.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: assistantContent,
      sourcesCount,
    },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: assistant.createdAt },
  });
  await logUsage({
    conversationId: conversation.id,
    departmentId: conversation.departmentId,
    provider: globalSettings.providerType,
    model: await safeModelName(globalSettings),
    promptTokens: rag.trace.promptTokens,
    completionTokens: rag.trace.completionTokens,
    latencyMs: rag.trace.durationMs || engineElapsed,
    outcome: rag.status === "ANSWERED" ? "ANSWERED" : "ABSTAINED",
  });
  return {
    ok: true,
    data: {
      userMessage,
      assistantMessage: toTranscript(assistant),
      escalatedOffer,
      mode: asConversationMode(conversation.mode),
    },
  };
}

// ------------------------------------------------------------- customer side --

export async function createConversation(input: {
  departmentId: string;
  customerName?: string | null;
  /** Phase 8 — citizen identity (کد ملی + password); links the conversation to the account. */
  nationalId?: string | null;
  password?: string | null;
  meta: RequestMeta;
}): Promise<Svc<CreateConversationResult>> {
  const ip = input.meta.ip ?? "unknown";
  if (!checkRateLimit(`conv:create:${ip}`, RATE_LIMIT_CONVERSATIONS_PER_HOUR, RATE_LIMIT_CONVERSATIONS_WINDOW_MS)) {
    return fail(429, ERR_RATE_LIMIT_CREATE);
  }

  const customerName = (input.customerName ?? "").trim().slice(0, MAX_CUSTOMER_NAME_CHARS) || null;

  const department = await db.department.findUnique({
    where: { id: input.departmentId },
    select: { id: true, name: true, aiEnabled: true, isActive: true, isPublic: true },
  });
  if (!department || !department.isActive || !department.isPublic) {
    return fail(404, ERR_DEPARTMENT_NOT_ACCEPTING);
  }

  // Phase 8 identity gate — کد ملی + password REQUIRED for every new chat.
  // Registers the citizen on first contact; logs in returning citizens.
  if (!input.nationalId || !input.password) {
    return fail(422, "برای شروع گفتگو، کد ملی و رمز عبور خود را وارد کنید.");
  }
  const identity = await resolveCitizenIdentity({
    nationalId: input.nationalId,
    fullName: customerName ?? "",
    password: input.password,
    via: "CHAT",
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });
  if (!identity.ok) return identity;

  const aiEnabled = department.aiEnabled && (await isAiGloballyEnabled());
  const mode: ConversationMode = aiEnabled ? "AI_ASSISTED" : "WAITING_FOR_OPERATOR";
  const welcomeContent = aiEnabled ? WELCOME_AI_MODE : WELCOME_OPERATOR_MODE;

  const token = randomBytes(24).toString("base64url");

  const conversation = await db.conversation.create({
    data: {
      departmentId: department.id,
      customerToken: token,
      customerName: identity.profile.fullName,
      customerId: identity.profile.id,
      mode,
      messages: {
        create: { role: "SYSTEM", content: welcomeContent },
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 1 } },
  });

  const welcome = conversation.messages[0];

  await audit({
    actorType: "CUSTOMER",
    actorLabel: identity.profile.fullName ?? GUEST_LABEL,
    action: "conversation.created",
    entityType: "Conversation",
    entityId: conversation.id,
    metadata: {
      departmentId: department.id,
      departmentName: department.name,
      mode,
      citizenLinked: true,
      newAccount: identity.created,
    },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return {
    ok: true,
    data: {
      token,
      mode,
      departmentName: department.name,
      welcomeAt: welcome ? welcome.createdAt.toISOString() : conversation.createdAt.toISOString(),
    },
  };
}

export async function getCustomerConversation(
  token: string
): Promise<Svc<CustomerConversationView>> {
  const conversation = await db.conversation.findUnique({
    where: { customerToken: token },
    include: {
      department: { select: { name: true, aiEnabled: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) {
    return fail(404, ERR_CONVERSATION_NOT_FOUND);
  }

  const escalationOffer = await getDepartmentAiSettings(conversation.departmentId).then(
    (settings) => settings.escalationOffer
  );

  return {
    ok: true,
    data: {
      mode: asConversationMode(conversation.mode),
      modeLabel: modeLabel(asConversationMode(conversation.mode)),
      departmentName: conversation.department.name,
      aiEnabled: conversation.department.aiEnabled,
      escalatedOfferAvailable: escalationOffer,
      messages: conversation.messages.map(toTranscript),
    },
  };
}

export async function addCustomerMessage(input: {
  token: string;
  content: string;
  meta: RequestMeta;
}): Promise<Svc<CustomerTurnResult>> {
  const token = input.token.trim();
  if (
    !checkRateLimit(
      `conv:msg:${token}`,
      RATE_LIMIT_MESSAGES_LIMIT,
      RATE_LIMIT_MESSAGES_WINDOW_MS
    )
  ) {
    return fail(429, ERR_RATE_LIMIT_MESSAGE);
  }

  const content = input.content.trim();
  if (content.length < MIN_MESSAGE_CHARS || content.length > MAX_MESSAGE_CHARS) {
    return fail(422, ERR_INVALID_CONTENT);
  }

  const conversation = await db.conversation.findUnique({
    where: { customerToken: token },
    include: {
      department: { select: { id: true, name: true, aiEnabled: true } },
    },
  });
  if (!conversation) {
    return fail(404, ERR_CONVERSATION_NOT_FOUND);
  }

  const mode = asConversationMode(conversation.mode);
  if (mode === "RESOLVED") {
    return fail(409, ERR_CONVERSATION_RESOLVED);
  }

  // Customer messages are ALWAYS preserved (spec §6.3) — persist first.
  const created = await db.conversationMessage.create({
    data: { conversationId: conversation.id, role: "CUSTOMER", content },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: created.createdAt },
  });
  const userMessage = toTranscript(created);

  if (mode !== "AI_ASSISTED") {
    return {
      ok: true,
      data: { userMessage, assistantMessage: null, escalatedOffer: false, mode },
    };
  }

  return runAssistantTurn(conversation, content, userMessage, input.meta);
}

export async function requestOperatorHandoff(input: {
  token: string;
  meta: RequestMeta;
}): Promise<Svc<{ mode: ConversationMode }>> {
  const conversation = await db.conversation.findUnique({
    where: { customerToken: input.token },
    include: { department: { select: { id: true, name: true } } },
  });
  if (!conversation) {
    return fail(404, ERR_CONVERSATION_NOT_FOUND);
  }

  const mode = asConversationMode(conversation.mode);
  if (mode === "RESOLVED") {
    return fail(409, ERR_CONVERSATION_RESOLVED);
  }
  if (mode !== "AI_ASSISTED") {
    return { ok: true, data: { mode } };
  }

  await db.conversationMessage.create({
    data: { conversationId: conversation.id, role: "SYSTEM", content: HANDOFF_REQUESTED_MESSAGE },
  });

  // Phase 4 linkage — the handoff creates a tracked ticket driven through
  // the fair-distribution engine. When an operator is available the
  // conversation moves straight to ASSIGNED_TO_OPERATOR; otherwise it stays
  // honestly queued (WAITING_FOR_OPERATOR). Phase 8: when the conversation
  // belongs to a citizen account, the ticket is linked to that account so
  // the citizen can track it from the portal.
  const handoffTicket = await createHandoffTicket({
    conversationId: conversation.id,
    departmentId: conversation.departmentId,
    customerName: conversation.customerName,
    customerId: conversation.customerId,
    meta: input.meta,
  });

  let nextMode: ConversationMode = "WAITING_FOR_OPERATOR";
  const updateData: { mode: ConversationMode; assignedToId?: string; lastMessageAt: Date } = {
    mode: nextMode,
    lastMessageAt: new Date(),
  };
  if (handoffTicket?.assigneeId) {
    nextMode = "ASSIGNED_TO_OPERATOR";
    updateData.mode = nextMode;
    updateData.assignedToId = handoffTicket.assigneeId;
  }
  await db.conversation.update({ where: { id: conversation.id }, data: updateData });

  await audit({
    actorType: "CUSTOMER",
    actorLabel: conversation.customerName ?? GUEST_LABEL,
    action: "conversation.handoff.requested",
    entityType: "Conversation",
    entityId: conversation.id,
    metadata: {
      departmentId: conversation.departmentId,
      departmentName: conversation.department.name,
      linkedTicketNumber: handoffTicket?.number ?? null,
      assignedAutomatically: Boolean(handoffTicket?.assigneeId),
    },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  await logUsage({
    conversationId: conversation.id,
    departmentId: conversation.departmentId,
    provider: "none",
    model: "-",
    outcome: "HANDOFF",
  });

  return { ok: true, data: { mode: nextMode } };
}

// -------------------------------------------------------------- staff side --

function excerpt(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > EXCERPT_CHARS ? `${trimmed.slice(0, EXCERPT_CHARS)}…` : trimmed;
}

function summarizeOne(row: {
  id: string;
  mode: string;
  customerName: string | null;
  customer: { nationalIdEnc: string } | null;
  departmentId: string;
  department: { name: string };
  assignedTo: { name: string } | null;
  lastMessageAt: Date;
  tickets?: Array<{ number: number }>;
  _count: { messages: number };
  messages: Array<{ role: string; content: string; createdAt: Date }>;
}): StaffConversationSummary {
  const lastNonSystem = [...row.messages]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .find((m) => m.role !== "SYSTEM");
  const mode = asConversationMode(row.mode);
  const nid = row.customer ? decryptNationalId(row.customer.nationalIdEnc) : null;
  return {
    id: row.id,
    mode,
    modeLabel: modeLabel(mode),
    departmentId: row.departmentId,
    departmentName: row.department.name,
    customerName: row.customerName,
    customerNationalIdMasked: nid ? maskNationalId(nid) : null,
    messageCount: row._count.messages,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessageExcerpt: lastNonSystem ? excerpt(lastNonSystem.content) : null,
    assignedToName: row.assignedTo?.name ?? null,
    linkedTicketNumber: row.tickets?.[0]?.number ?? null,
  };
}

export async function listStaffConversations(
  user: StaffActor,
  opts?: { filter?: "active" | "resolved" | "all" }
): Promise<Svc<{ conversations: StaffConversationSummary[] }>> {
  const filter = opts?.filter ?? "active";
  const scope = await resolveDepartmentScope(user.id);

  const conversations = await db.conversation.findMany({
    where: {
      ...(scope.all ? {} : { departmentId: { in: scope.departmentIds } }),
      ...(filter === "active" ? { mode: { not: "RESOLVED" } } : {}),
      ...(filter === "resolved" ? { mode: "RESOLVED" } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: STAFF_LIST_SIZE,
    include: {
      department: { select: { name: true } },
      assignedTo: { select: { name: true } },
      customer: { select: { nationalIdEnc: true } },
      tickets: { select: { number: true }, take: 1, orderBy: { createdAt: "desc" } },
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 10, select: { role: true, content: true, createdAt: true } },
    },
  });

  return { ok: true, data: { conversations: conversations.map(summarizeOne) } };
}

export async function getStaffConversation(
  user: StaffActor,
  conversationId: string
): Promise<Svc<{ conversation: StaffConversationSummary & { messages: TranscriptMessage[] } }>> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      department: { select: { name: true } },
      assignedTo: { select: { name: true } },
      customer: { select: { nationalIdEnc: true } },
      tickets: { select: { number: true }, take: 1, orderBy: { createdAt: "desc" } },
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) {
    return fail(404, ERR_CONVERSATION_NOT_FOUND);
  }

  const allowed = await hasDepartmentAccess(user.id, conversation.departmentId);
  if (!allowed) {
    return fail(403, ERR_NO_DEPARTMENT_ACCESS);
  }

  const summary = summarizeOne(conversation);
  return {
    ok: true,
    data: {
      conversation: {
        ...summary,
        messages: conversation.messages.map(toTranscript),
      },
    },
  };
}

export async function replyAsOperator(input: {
  user: StaffActor;
  conversationId: string;
  content: string;
  meta: RequestMeta;
}): Promise<Svc<{ message: TranscriptMessage; mode: ConversationMode }>> {
  const content = input.content.trim();
  if (content.length < MIN_MESSAGE_CHARS || content.length > MAX_MESSAGE_CHARS) {
    return fail(422, ERR_INVALID_CONTENT);
  }

  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    include: { department: { select: { id: true, name: true } } },
  });
  if (!conversation) {
    return fail(404, ERR_CONVERSATION_NOT_FOUND);
  }

  const allowed = await hasDepartmentAccess(input.user.id, conversation.departmentId);
  if (!allowed) {
    return fail(403, ERR_NO_DEPARTMENT_ACCESS);
  }

  const mode = asConversationMode(conversation.mode);
  if (mode === "RESOLVED") {
    return fail(409, ERR_CONVERSATION_RESOLVED);
  }

  const created = await db.conversationMessage.create({
    data: { conversationId: conversation.id, role: "OPERATOR", content },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      mode: "HUMAN_ACTIVE",
      ...(conversation.assignedToId ? {} : { assignedToId: input.user.id }),
      lastMessageAt: created.createdAt,
    },
  });

  // Keep the linked ticket consistent (self-assign / first response / status).
  await touchTicketForOperatorReply(
    conversation.id,
    input.user.id,
    (input.user as { name?: string }).name || input.user.username
  );

  await audit({
    actorType: "USER",
    actorUserId: input.user.id,
    actorLabel: input.user.username,
    action: "conversation.operator.replied",
    entityType: "Conversation",
    entityId: conversation.id,
    metadata: { departmentId: conversation.departmentId, messageId: created.id },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return {
    ok: true,
    data: { message: toTranscript(created), mode: "HUMAN_ACTIVE" },
  };
}

export async function resolveConversation(input: {
  user: StaffActor;
  conversationId: string;
  meta: RequestMeta;
}): Promise<Svc<{ mode: ConversationMode }>> {
  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    include: { department: { select: { id: true, name: true } } },
  });
  if (!conversation) {
    return fail(404, ERR_CONVERSATION_NOT_FOUND);
  }

  const allowed = await hasDepartmentAccess(input.user.id, conversation.departmentId);
  if (!allowed) {
    return fail(403, ERR_NO_DEPARTMENT_ACCESS);
  }

  const mode = asConversationMode(conversation.mode);
  if (mode === "RESOLVED") {
    return { ok: true, data: { mode } };
  }

  await db.conversationMessage.create({
    data: { conversationId: conversation.id, role: "SYSTEM", content: RESOLVED_MESSAGE },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: { mode: "RESOLVED", lastMessageAt: new Date() },
  });

  // Phase 4 linkage — resolving the conversation resolves the tracked ticket.
  await resolveTicketsForConversation(conversation.id);

  await audit({
    actorType: "USER",
    actorUserId: input.user.id,
    actorLabel: input.user.username,
    action: "conversation.resolved",
    entityType: "Conversation",
    entityId: conversation.id,
    metadata: { departmentId: conversation.departmentId, departmentName: conversation.department.name },
    ip: input.meta.ip ?? undefined,
    userAgent: input.meta.userAgent ?? undefined,
  });

  return { ok: true, data: { mode: "RESOLVED" } };
}
