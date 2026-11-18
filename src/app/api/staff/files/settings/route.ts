import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiError,
  apiOk,
  assertSameOrigin,
  parseBody,
  requirePermission,
} from "@/lib/api";
import { audit } from "@/lib/audit";
import { getStorageSettingsView } from "@/lib/files/service";
import { saveStorageSettings, saveAvSettings } from "@/lib/files/settings";
import { AV_PROVIDER_TYPES } from "@/lib/files/types";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  totalCapacityBytes: z.number().int().min(1024 * 1024).optional(),
  defaultDepartmentQuotaBytes: z.number().int().min(1024 * 1024).optional(),
  defaultOperatorQuotaBytes: z.number().int().min(1024 * 1024).optional(),
  maxUploadBytes: z.number().int().min(1024 * 1024).optional(),
  allowedExtensions: z.array(z.string().min(1).max(10)).optional(),
  av: z
    .object({
      provider: z.enum(AV_PROVIDER_TYPES).optional(),
      host: z.string().min(1).max(255).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      timeoutMs: z.number().int().min(1000).max(60000).optional(),
    })
    .optional(),
});

/** GET /api/staff/files/settings — storage settings view (admin only). */
export async function GET() {
  const guard = await requirePermission("admin.storage.manage");
  if (!guard.ok) return guard.response;

  try {
    const view = await getStorageSettingsView();
    return apiOk(view);
  } catch (error) {
    console.error("[api/staff/files/settings] read failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}

/** PUT /api/staff/files/settings — update storage/AV settings (admin only). */
export async function PUT(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("admin.storage.manage");
  if (!guard.ok) return guard.response;

  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  try {
    const global = await saveStorageSettings({
      totalCapacityBytes: body.data.totalCapacityBytes,
      defaultDepartmentQuotaBytes: body.data.defaultDepartmentQuotaBytes,
      defaultOperatorQuotaBytes: body.data.defaultOperatorQuotaBytes,
      maxUploadBytes: body.data.maxUploadBytes,
      allowedExtensions: body.data.allowedExtensions,
    });
    const av = body.data.av ? await saveAvSettings(body.data.av) : undefined;

    await audit({
      actorType: "USER",
      actorUserId: guard.user.id,
      actorLabel: guard.user.username,
      action: "storage.settings.updated",
      entityType: "systemSetting",
      entityId: "storage.global",
      metadata: {
        totalCapacityBytes: global.totalCapacityBytes,
        maxUploadBytes: global.maxUploadBytes,
        allowedExtensions: global.allowedExtensions,
        avProvider: av?.provider ?? "unchanged",
      },
    });

    return apiOk({ global, av: av ?? (await getStorageSettingsView()).av });
  } catch (error) {
    if (error instanceof Error && error.name === "Error" && error.message.includes("سهمیه")) {
      return apiError(error.message, 422, "VALIDATION_ERROR");
    }
    console.error("[api/staff/files/settings] update failed:", error);
    return apiError("ذخیره تنظیمات ناموفق بود.", 500);
  }
}
