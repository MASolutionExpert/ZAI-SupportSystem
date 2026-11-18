import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { DepartmentAiSettings } from "./types";

/**
 * Per-department AI behavior — stored as JSON in Department.aiSettings on top
 * of the Department.aiEnabled master flag. All user-facing strings are the
 * mandated Persian texts; do not reword them (AI-ARCHITECTURE §4).
 */

export const STANDARD_FALLBACK_MESSAGE = "برای پاسخ دقیق به این سؤال، اطلاعات تأییدشده‌ای در مخزن دانش سازمان پیدا نشد. می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.";

export const PROVIDER_UNAVAILABLE_MESSAGE = "در حال حاضر امکان پاسخ‌گویی خودکار وجود ندارد؛ لطفاً چند لحظه دیگر دوباره تلاش کنید یا درخواست خود را به اپراتور ارجاع دهید.";

export const LIMIT_REACHED_MESSAGE = "سهمیه گفتگوی امروز برای دستیار هوشمند این دپارتمان تکمیل شده است. می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.";

const DEFAULT_DEPARTMENT_AI_SETTINGS: DepartmentAiSettings = {
  minConfidence: 0.35,
  escalationOffer: true,
  fallbackMessage: null,
  dailyMessageLimit: null,
};

type Actor = { id: string; label: string };
type Meta = { ip?: string | null; userAgent?: string | null };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// ------------------------------------------------------- defensive parsing --

/** `fallbackMessage`: null or a trimmed 3..500-char string; else null. */
function parseFallbackMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 500) return null;
  return trimmed;
}

function parseDailyMessageLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(clamp(value, 1, 1000));
}

function parseStoredAiSettings(stored: unknown): DepartmentAiSettings {
  if (stored === null || stored === undefined || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...DEFAULT_DEPARTMENT_AI_SETTINGS };
  }
  const raw = stored as Record<string, unknown>;
  const minConfidence =
    typeof raw.minConfidence === "number" && Number.isFinite(raw.minConfidence)
      ? clamp(raw.minConfidence, 0, 1)
      : DEFAULT_DEPARTMENT_AI_SETTINGS.minConfidence;

  return {
    minConfidence,
    escalationOffer:
      typeof raw.escalationOffer === "boolean"
        ? raw.escalationOffer
        : DEFAULT_DEPARTMENT_AI_SETTINGS.escalationOffer,
    fallbackMessage: parseFallbackMessage(raw.fallbackMessage),
    dailyMessageLimit: parseDailyMessageLimit(raw.dailyMessageLimit),
  };
}

// ----------------------------------------------------------------- queries --

export async function getDepartmentAiSettings(
  departmentId: string
): Promise<DepartmentAiSettings & { aiEnabled: boolean }> {
  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { aiEnabled: true, aiSettings: true },
  });
  if (!department) {
    throw new Error("دپارتمان یافت نشد.");
  }

  let stored: unknown = null;
  if (department.aiSettings) {
    try {
      stored = JSON.parse(department.aiSettings);
    } catch {
      stored = null;
    }
  }

  return { ...parseStoredAiSettings(stored), aiEnabled: department.aiEnabled };
}

// ---------------------------------------------------------------- mutations --

function clampPatch(patch: Partial<DepartmentAiSettings>): Partial<DepartmentAiSettings> {
  const next: Partial<DepartmentAiSettings> = {};
  if (patch.minConfidence !== undefined) {
    next.minConfidence = clamp(patch.minConfidence, 0, 1);
  }
  if (patch.escalationOffer !== undefined) {
    next.escalationOffer = patch.escalationOffer;
  }
  if (patch.fallbackMessage !== undefined) {
    next.fallbackMessage = parseFallbackMessage(patch.fallbackMessage);
  }
  if (patch.dailyMessageLimit !== undefined) {
    next.dailyMessageLimit = parseDailyMessageLimit(patch.dailyMessageLimit);
  }
  return next;
}

export async function updateDepartmentAiSettings(
  departmentId: string,
  patch: Partial<DepartmentAiSettings>,
  updatedBy: Actor,
  meta: Meta
): Promise<DepartmentAiSettings & { aiEnabled: boolean }> {
  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, aiSettings: true },
  });
  if (!department) {
    throw new Error("دپارتمان یافت نشد.");
  }

  let stored: unknown = null;
  if (department.aiSettings) {
    try {
      stored = JSON.parse(department.aiSettings);
    } catch {
      stored = null;
    }
  }

  const merged = { ...parseStoredAiSettings(stored), ...clampPatch(patch) };

  const updated = await db.department.update({
    where: { id: departmentId },
    data: { aiSettings: JSON.stringify(merged) },
    select: { aiEnabled: true },
  });

  const changed = Object.keys(clampPatch(patch)).filter((key) => {
    const before = (parseStoredAiSettings(stored) as unknown as Record<string, unknown>)[key];
    const after = (merged as unknown as Record<string, unknown>)[key];
    return before !== after;
  });

  await audit({
    actorType: "USER",
    actorUserId: updatedBy.id,
    actorLabel: updatedBy.label,
    action: "ai.department.settings.updated",
    entityType: "Department",
    entityId: departmentId,
    metadata: { departmentName: department.name, changed },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return { ...merged, aiEnabled: updated.aiEnabled };
}

export async function setDepartmentAiEnabled(
  departmentId: string,
  enabled: boolean,
  updatedBy: Actor,
  meta: Meta
): Promise<DepartmentAiSettings & { aiEnabled: boolean }> {
  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true },
  });
  if (!department) {
    throw new Error("دپارتمان یافت نشد.");
  }

  await db.department.update({
    where: { id: departmentId },
    data: { aiEnabled: enabled },
  });

  await audit({
    actorType: "USER",
    actorUserId: updatedBy.id,
    actorLabel: updatedBy.label,
    action: enabled ? "ai.department.enabled" : "ai.department.disabled",
    entityType: "Department",
    entityId: departmentId,
    metadata: { departmentName: department.name },
    ip: meta.ip ?? undefined,
    userAgent: meta.userAgent ?? undefined,
  });

  return getDepartmentAiSettings(departmentId);
}
