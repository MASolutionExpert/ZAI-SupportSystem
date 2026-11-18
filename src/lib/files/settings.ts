import "server-only";

import { getSetting, setSetting } from "@/lib/settings";
import {
  DEFAULT_AV_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  AV_PROVIDER_TYPES,
  type StorageAvSettings,
  type StorageGlobalSettings,
  type AvProviderType,
} from "./types";

/**
 * Storage settings — persisted as JSON under the SystemSetting keys
 * `storage.global` (capacity/quotas/allowlist) and `storage.av` (antivirus
 * integration point). Defensive parsing mirrors ai/settings.ts.
 */

export const STORAGE_GLOBAL_KEY = "storage.global";
export const STORAGE_AV_KEY = "storage.av";

// ------------------------------------------------------- defensive parsing --

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asIntInRange(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

function parseGlobal(stored: unknown): StorageGlobalSettings {
  if (stored === null || stored === undefined || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...DEFAULT_STORAGE_SETTINGS };
  }
  const raw = stored as Record<string, unknown>;
  const defaults = DEFAULT_STORAGE_SETTINGS;

  const extensions = Array.isArray(raw.allowedExtensions)
    ? raw.allowedExtensions
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.toLowerCase().trim())
        .filter((e) => /^[a-z0-9]{1,10}$/.test(e))
        .filter((e) => defaults.allowedExtensions.includes(e) || isKnownExtension(e))
    : defaults.allowedExtensions;

  return {
    totalCapacityBytes:
      asIntInRange(raw.totalCapacityBytes, 1024 * 1024, 1024 * 1024 * 1024 * 1024) ??
      defaults.totalCapacityBytes,
    defaultDepartmentQuotaBytes:
      asIntInRange(raw.defaultDepartmentQuotaBytes, 1024 * 1024, 1024 * 1024 * 1024 * 1024) ??
      defaults.defaultDepartmentQuotaBytes,
    defaultOperatorQuotaBytes:
      asIntInRange(raw.defaultOperatorQuotaBytes, 1024 * 1024, 1024 * 1024 * 1024 * 1024) ??
      defaults.defaultOperatorQuotaBytes,
    maxUploadBytes:
      asIntInRange(raw.maxUploadBytes, 1024 * 1024, 1024 * 1024 * 1024) ??
      defaults.maxUploadBytes,
    allowedExtensions: extensions.length > 0 ? extensions : defaults.allowedExtensions,
  };
}

function isKnownExtension(ext: string): boolean {
  // txt/csv are text-verifiable and part of defaults; this keeps any future
  // text-adjacent type out unless added here deliberately.
  return ["pdf", "png", "jpg", "webp", "zip", "docx", "txt", "csv"].includes(ext);
}

function parseAv(stored: unknown): StorageAvSettings {
  if (stored === null || stored === undefined || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...DEFAULT_AV_SETTINGS };
  }
  const raw = stored as Record<string, unknown>;
  const provider = asString(raw.provider);
  return {
    provider:
      provider && (AV_PROVIDER_TYPES as readonly string[]).includes(provider)
        ? (provider as AvProviderType)
        : DEFAULT_AV_SETTINGS.provider,
    host: asString(raw.host)?.trim() || DEFAULT_AV_SETTINGS.host,
    port: asIntInRange(raw.port, 1, 65535) ?? DEFAULT_AV_SETTINGS.port,
    timeoutMs: asIntInRange(raw.timeoutMs, 1000, 60000) ?? DEFAULT_AV_SETTINGS.timeoutMs,
  };
}

// ------------------------------------------------------------------ reads --

export async function getStorageSettings(): Promise<StorageGlobalSettings> {
  const stored = await getSetting<unknown>(STORAGE_GLOBAL_KEY);
  return parseGlobal(stored);
}

export async function getAvSettings(): Promise<StorageAvSettings> {
  const stored = await getSetting<unknown>(STORAGE_AV_KEY);
  return parseAv(stored);
}

// ----------------------------------------------------------------- writes --

export async function saveStorageSettings(
  input: Partial<StorageGlobalSettings>
): Promise<StorageGlobalSettings> {
  const current = await getStorageSettings();

  // Sanity: quotas must not exceed capacity; upload cap must not exceed
  // department quota (fail closed on nonsense configuration). Lowering any
  // value is allowed — the chain below is the guard, not a ratchet.
  const totalCapacityBytes = input.totalCapacityBytes ?? current.totalCapacityBytes;
  const departmentQuota = input.defaultDepartmentQuotaBytes ?? current.defaultDepartmentQuotaBytes;
  const operatorQuota = input.defaultOperatorQuotaBytes ?? current.defaultOperatorQuotaBytes;
  const maxUpload = input.maxUploadBytes ?? current.maxUploadBytes;

  if (departmentQuota > totalCapacityBytes) {
    throw new Error("سهمیه پیش‌فرض دپارتمان نمی‌تواند از ظرفیت کل بیشتر باشد.");
  }
  if (operatorQuota > departmentQuota) {
    throw new Error("سهمیه پیش‌فرض اپراتور نمی‌تواند از سهمیه دپارتمان بیشتر باشد.");
  }
  if (maxUpload > operatorQuota) {
    throw new Error("حداکثر حجم هر فایل نمی‌تواند از سهمیه اپراتور بیشتر باشد.");
  }

  const next: StorageGlobalSettings = {
    totalCapacityBytes,
    defaultDepartmentQuotaBytes: departmentQuota,
    defaultOperatorQuotaBytes: operatorQuota,
    maxUploadBytes: maxUpload,
    allowedExtensions: input.allowedExtensions
      ? input.allowedExtensions
          .map((e) => e.toLowerCase().trim())
          .filter((e) => /^[a-z0-9]{1,10}$/.test(e) && isKnownExtension(e))
      : current.allowedExtensions,
  };
  if (next.allowedExtensions.length === 0) {
    throw new Error("حداقل یک نوع فایل مجاز باید انتخاب شود.");
  }

  await setSetting(STORAGE_GLOBAL_KEY, next);
  return next;
}

export async function saveAvSettings(input: Partial<StorageAvSettings>): Promise<StorageAvSettings> {
  const current = await getAvSettings();
  const provider = input.provider ?? current.provider;
  if (!(AV_PROVIDER_TYPES as readonly string[]).includes(provider)) {
    throw new Error("ارائه‌دهنده اسکن نامعتبر است.");
  }
  const next: StorageAvSettings = {
    provider,
    host: input.host?.trim() || current.host,
    port: input.port ?? current.port,
    timeoutMs: input.timeoutMs ?? current.timeoutMs,
  };
  await setSetting(STORAGE_AV_KEY, next);
  return next;
}
