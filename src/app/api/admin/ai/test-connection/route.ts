import { NextRequest } from "next/server";
import {
  apiOk,
  apiError,
  assertSameOrigin,
  requirePermission,
  requestMeta,
} from "@/lib/api";
import { audit } from "@/lib/audit";
import { createAdapter, sanitizeSecrets } from "@/lib/ai/adapter";
import { getAiGlobalSettings } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ai/test-connection — probe the active provider with stored
 * settings. Connection failures are reported as an ok:false result (never a
 * 500), with all credential-like fragments stripped from the detail text.
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requirePermission("ai.connection.test");
  if (!guard.ok) return guard.response;

  const meta = requestMeta(req);

  try {
    const settings = await getAiGlobalSettings();
    const adapter = createAdapter(settings);
    const startedAt = Date.now();

    try {
      const result = await adapter.testConnection();
      const latencyMs = Date.now() - startedAt;

      await audit({
        actorType: "USER",
        actorUserId: guard.user.id,
        actorLabel: guard.user.username,
        action: "ai.provider.tested",
        entityType: "SystemSetting",
        metadata: { ok: result.ok, provider: settings.providerType, latencyMs },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return apiOk({
        ok: result.ok,
        provider: settings.providerType,
        detail: result.detail,
        models: result.models,
        latencyMs,
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const detail = `اتصال برقرار نشد: ${sanitizeSecrets(message)}`;

      await audit({
        actorType: "USER",
        actorUserId: guard.user.id,
        actorLabel: guard.user.username,
        action: "ai.provider.tested",
        entityType: "SystemSetting",
        metadata: { ok: false, provider: settings.providerType, latencyMs },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return apiOk({
        ok: false,
        provider: settings.providerType,
        detail,
        models: [],
        latencyMs,
      });
    }
  } catch (error) {
    console.error("[api/admin/ai/test-connection] failed:", error);
    return apiError("اجرای تست اتصال ناموفق بود.", 500, "TEST_FAILED");
  }
}
