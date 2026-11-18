import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiOk,
  apiError,
  requirePermission,
  assertSameOrigin,
  parseBody,
  requestMeta,
} from "@/lib/api";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settings (admin.settings.manage) — current system-wide
 * settings with the live values actually consumed by the public surfaces.
 * PUT (admin.settings.manage) — validates, persists, and audits changes.
 */

const upsertSchema = z.object({
  orgName: z
    .string()
    .trim()
    .min(2, "نام سازمان باید حداقل ۲ نویسه باشد.")
    .max(80, "نام سازمان حداکثر ۸۰ نویسه است."),
  orgTagline: z
    .string()
    .trim()
    .max(120, "شعار حداکثر ۱۲۰ نویسه است.")
    .optional()
    .default(""),
  orgSupportIntro: z
    .string()
    .trim()
    .max(300, "متن معرفی حداکثر ۳۰۰ نویسه است.")
    .optional()
    .default(""),
});

async function loadSettingsWithMeta() {
  const [orgName, orgTagline, orgSupportIntro, rows] = await Promise.all([
    getSetting<string>(SETTING_KEYS.ORG_NAME),
    getSetting<string>(SETTING_KEYS.ORG_TAGLINE),
    getSetting<string>(SETTING_KEYS.ORG_SUPPORT_INTRO),
    db.systemSetting.findMany({
      where: { key: { in: [SETTING_KEYS.ORG_NAME, SETTING_KEYS.ORG_TAGLINE, SETTING_KEYS.ORG_SUPPORT_INTRO] } },
      select: { key: true, updatedBy: true, updatedAt: true },
    }),
  ]);

  const meta = new Map(rows.map((r) => [r.key, r]));
  return {
    values: {
      orgName,
      orgTagline,
      orgSupportIntro,
    },
    meta: {
      orgName: meta.get(SETTING_KEYS.ORG_NAME)
        ? {
            updatedBy: meta.get(SETTING_KEYS.ORG_NAME)?.updatedBy ?? null,
            updatedAt: meta.get(SETTING_KEYS.ORG_NAME)?.updatedAt.toISOString() ?? null,
          }
        : null,
      orgTagline: meta.get(SETTING_KEYS.ORG_TAGLINE)
        ? {
            updatedBy: meta.get(SETTING_KEYS.ORG_TAGLINE)?.updatedBy ?? null,
            updatedAt: meta.get(SETTING_KEYS.ORG_TAGLINE)?.updatedAt.toISOString() ?? null,
          }
        : null,
      orgSupportIntro: meta.get(SETTING_KEYS.ORG_SUPPORT_INTRO)
        ? {
            updatedBy: meta.get(SETTING_KEYS.ORG_SUPPORT_INTRO)?.updatedBy ?? null,
            updatedAt: meta.get(SETTING_KEYS.ORG_SUPPORT_INTRO)?.updatedAt.toISOString() ?? null,
          }
        : null,
    },
  };
}

export async function GET() {
  const guard = await requirePermission("admin.settings.manage");
  if (!guard.ok) return guard.response;

  try {
    return apiOk(await loadSettingsWithMeta());
  } catch (error) {
    console.error("[api/admin/settings] GET failed:", error);
    return apiError("دریافت تنظیمات ناموفق بود.", 500, "SETTINGS_READ_FAILED");
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission("admin.settings.manage");
  if (!guard.ok) return guard.response;

  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const parsed = await parseBody(req, upsertSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const before = await loadSettingsWithMeta();
    const next = parsed.data;

    // Persist only keys whose value actually changed; collect the diff for
    // the audit record.
    const changes: Array<{ key: string; from: string; to: string }> = [];
    const applied: Array<{ key: string; value: string }> = [];

    if (next.orgName !== before.values.orgName) {
      applied.push({ key: SETTING_KEYS.ORG_NAME, value: next.orgName });
      changes.push({ key: SETTING_KEYS.ORG_NAME, from: before.values.orgName, to: next.orgName });
    }
    if (next.orgTagline !== before.values.orgTagline) {
      applied.push({ key: SETTING_KEYS.ORG_TAGLINE, value: next.orgTagline });
      changes.push({ key: SETTING_KEYS.ORG_TAGLINE, from: before.values.orgTagline, to: next.orgTagline });
    }
    if (next.orgSupportIntro !== before.values.orgSupportIntro) {
      applied.push({ key: SETTING_KEYS.ORG_SUPPORT_INTRO, value: next.orgSupportIntro });
      changes.push({
        key: SETTING_KEYS.ORG_SUPPORT_INTRO,
        from: before.values.orgSupportIntro,
        to: next.orgSupportIntro,
      });
    }

    for (const item of applied) {
      await setSetting(item.key, item.value, guard.user.username);
    }

    if (changes.length > 0) {
      await audit({
        actorType: "USER",
        actorUserId: guard.user.id,
        actorLabel: guard.user.username,
        action: "settings.org.updated",
        entityType: "SystemSetting",
        metadata: { changes: changes.map((c) => ({ key: c.key })) },
        ...requestMeta(req),
      });
    }

    const after = await loadSettingsWithMeta();
    return apiOk({ changedKeys: changes.map((c) => c.key), ...after });
  } catch (error) {
    console.error("[api/admin/settings] PUT failed:", error);
    return apiError("ذخیره تنظیمات ناموفق بود.", 500, "SETTINGS_WRITE_FAILED");
  }
}
