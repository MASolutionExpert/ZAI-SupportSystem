import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { can } from "@/lib/rbac/service";
import { audit } from "@/lib/audit";
import { AI_PROVIDER_TYPES } from "@/lib/ai/types";
import { AI_GLOBAL_KEY, getAiGlobalSettingsPublic, updateAiGlobalSettings } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

/**
 * Global AI provider settings.
 *   GET — public view (api key never included, only set/masked markers).
 *   PUT — partial update; the plaintext `apiKey` is encrypted at rest and
 *         requires the dedicated `ai.credentials.update` permission.
 */

const settingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  providerType: z.enum(AI_PROVIDER_TYPES).optional(),
  chatModel: z.string().trim().max(100, "نام مدل حداکثر ۱۰۰ کاراکتر است.").optional(),
  embeddingModel: z.string().trim().max(100, "نام مدل حداکثر ۱۰۰ کاراکتر است.").optional(),
  baseUrl: z.string().trim().max(500, "آدرس Base URL حداکثر ۵۰۰ کاراکتر است.").optional(),
  apiKey: z.string().max(500, "کلید API حداکثر ۵۰۰ کاراکتر است.").nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(50).max(4000).optional(),
  timeoutMs: z.number().int().min(5000).max(120000).optional(),
});

/** GET /api/admin/ai/settings — key-free public view of global AI settings. */
export async function GET() {
  const guard = await requirePermission("ai.settings.access");
  if (!guard.ok) return guard.response;

  return apiOk(await getAiGlobalSettingsPublic());
}

/** PUT /api/admin/ai/settings — update global AI provider configuration. */
export async function PUT(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("ai.provider.configure");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, settingsUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const patch = parsed.data;

  // Credential changes need the dedicated permission, even for admins that
  // may only configure the provider.
  if (patch.apiKey !== undefined) {
    const credAllowed = await can(guard.user.id, "ai.credentials.update");
    if (!credAllowed) {
      return apiError("برای به‌روزرسانی کلید API دسترسی لازم را ندارید.", 403, "FORBIDDEN");
    }
  }

  try {
    // Cross-field validation for the openai-compatible provider, resolved
    // against stored values when fields are omitted.
    const current = await getAiGlobalSettingsPublic();
    const effectiveProviderType = patch.providerType ?? current.providerType;
    const effectiveBaseUrl = patch.baseUrl ?? current.baseUrl;
    const effectiveChatModel = patch.chatModel ?? current.chatModel;
    const keyProvided = patch.apiKey !== undefined && patch.apiKey !== null && patch.apiKey.trim().length > 0;
    const effectiveKeySet = keyProvided || current.apiKeySet;

    if (effectiveProviderType === "openai-compatible") {
      if (!/^https?:\/\//i.test(effectiveBaseUrl)) {
        return apiError("آدرس Base URL معتبر لازم است.", 422, "VALIDATION_ERROR");
      }
      if (!effectiveKeySet) {
        return apiError("کلید API لازم است.", 422, "VALIDATION_ERROR");
      }
      if (!effectiveChatModel) {
        return apiError("انتخاب مدل گفتگو برای این سرویس لازم است.", 422, "VALIDATION_ERROR");
      }
    }

    const settings = await updateAiGlobalSettings(patch, guard.user.id);
    const meta = requestMeta(req);

    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "ai.provider.configured",
      entityType: "SystemSetting",
      entityId: AI_GLOBAL_KEY,
      metadata: { changed: Object.keys(patch), providerType: settings.providerType },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk(settings);
  } catch (error) {
    console.error("[api/admin/ai/settings] update failed:", error);
    return apiError("ذخیره تنظیمات هوش مصنوعی ناموفق بود.", 500, "SAVE_FAILED");
  }
}
