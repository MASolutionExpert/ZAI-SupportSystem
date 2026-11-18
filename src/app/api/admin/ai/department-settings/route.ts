import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  parseBody,
  requireAuth,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { can } from "@/lib/rbac/service";
import { db } from "@/lib/db";
import {
  getDepartmentAiSettings,
  setDepartmentAiEnabled,
  updateDepartmentAiSettings,
} from "@/lib/ai/departments";

export const dynamic = "force-dynamic";

/**
 * Per-department AI configuration (Department.aiEnabled + aiSettings JSON).
 *   GET — requires `ai.settings.access` OR `ai.department.settings.manage`.
 *   PUT — requires `ai.department.settings.manage`.
 */

const departmentAiSettingsUpdateSchema = z.object({
  departmentId: z.string().min(1, "شناسه دپارتمان لازم است."),
  aiEnabled: z.boolean().optional(),
  minConfidence: z.number().min(0).max(0.9).optional(),
  escalationOffer: z.boolean().optional(),
  fallbackMessage: z
    .string()
    .trim()
    .min(3, "پیام جایگزین باید حداقل ۳ کاراکتر باشد.")
    .max(500, "پیام جایگزین حداکثر ۵۰۰ کاراکتر است.")
    .nullable()
    .optional(),
  dailyMessageLimit: z.number().int().min(1).max(1000).nullable().optional(),
});

/** GET /api/admin/ai/department-settings?departmentId=... */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const allowed =
    (await can(auth.user.id, "ai.settings.access")) ||
    (await can(auth.user.id, "ai.department.settings.manage"));
  if (!allowed) {
    return apiError("دسترسی لازم را ندارید.", 403, "FORBIDDEN");
  }

  const departmentId = req.nextUrl.searchParams.get("departmentId")?.trim() ?? "";
  if (!departmentId) {
    return apiError("شناسه دپارتمان لازم است.", 400, "MISSING_DEPARTMENT");
  }

  try {
    const department = await db.department.findUnique({
      where: { id: departmentId },
      select: { id: true, name: true },
    });
    if (!department) {
      return apiError("دپارتمان یافت نشد.", 404, "NOT_FOUND");
    }

    const { aiEnabled, ...settings } = await getDepartmentAiSettings(departmentId);
    return apiOk({
      departmentId: department.id,
      departmentName: department.name,
      aiEnabled,
      settings,
    });
  } catch (error) {
    console.error("[api/admin/ai/department-settings] read failed:", error);
    return apiError("خواندن تنظیمات هوش مصنوعی دپارتمان ناموفق بود.", 500, "READ_FAILED");
  }
}

/** PUT /api/admin/ai/department-settings — update the AI toggle and behavior. */
export async function PUT(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("ai.department.settings.manage");
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, departmentAiSettingsUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { departmentId, aiEnabled, ...settingsPatch } = parsed.data;
  const hasSettingsPatch = Object.keys(settingsPatch).length > 0;
  if (aiEnabled === undefined && !hasSettingsPatch) {
    return apiError("داده‌ای برای به‌روزرسانی ارسال نشده است.", 422, "EMPTY_UPDATE");
  }

  const meta = requestMeta(req);
  const actor = { id: guard.user.id, label: guard.user.username };

  try {
    const department = await db.department.findUnique({
      where: { id: departmentId },
      select: { id: true, name: true },
    });
    if (!department) {
      return apiError("دپارتمان یافت نشد.", 404, "NOT_FOUND");
    }

    if (aiEnabled !== undefined) {
      await setDepartmentAiEnabled(departmentId, aiEnabled, actor, meta);
    }

    const current = hasSettingsPatch
      ? await updateDepartmentAiSettings(departmentId, settingsPatch, actor, meta)
      : await getDepartmentAiSettings(departmentId);

    const { aiEnabled: effectiveAiEnabled, ...settings } = current;
    return apiOk({
      departmentId,
      departmentName: department.name,
      aiEnabled: effectiveAiEnabled,
      settings,
    });
  } catch (error) {
    console.error("[api/admin/ai/department-settings] update failed:", error);
    return apiError("به‌روزرسانی تنظیمات هوش مصنوعی دپارتمان ناموفق بود.", 500, "SAVE_FAILED");
  }
}
