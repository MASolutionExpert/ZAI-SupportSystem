"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, Save, Settings2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StorageSettingsFields,
  StorageUsageView,
  type StorageSettingsView,
  type UsageReport,
} from "@/components/files/storage-views";

type StorageSettingsPayload = { global: StorageSettingsView["global"]; av: StorageSettingsView["av"] };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const payload = (await res.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: string }
      | null;
    if (!payload) return { ok: false, error: "پاسخ سرور نامعتبر بود." };
    if (!payload.ok) return { ok: false, error: payload.error };
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, error: "ارتباط با سرور برقرار نشد." };
  }
}

/**
 * Consolidated storage administration (Phase 6) — the same endpoints and
 * shared views as the /files workspace dialogs, on a single page:
 * usage report + capacity/quota/extension settings + antivirus integration.
 */
export function StorageAdmin({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<StorageSettingsPayload | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [settingsResult, usageResult] = await Promise.all([
      fetchJson<StorageSettingsPayload>("/api/staff/files/settings"),
      fetchJson<UsageReport>("/api/staff/files/usage"),
    ]);
    setLoading(false);
    if (settingsResult.ok) setSettings(settingsResult.data);
    if (usageResult.ok) setUsage(usageResult.data);
    if (!settingsResult.ok && !usageResult.ok) {
      setError(settingsResult.error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) void load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadToken]);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    const result = await fetchJson<StorageSettingsPayload>("/api/staff/files/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalCapacityBytes: settings.global.totalCapacityBytes,
        defaultDepartmentQuotaBytes: settings.global.defaultDepartmentQuotaBytes,
        defaultOperatorQuotaBytes: settings.global.defaultOperatorQuotaBytes,
        maxUploadBytes: settings.global.maxUploadBytes,
        allowedExtensions: settings.global.allowedExtensions,
        av: {
          provider: settings.av.provider,
          host: settings.av.host,
          port: settings.av.port,
          timeoutMs: settings.av.timeoutMs,
        },
      }),
    });
    setSaving(false);
    if (result.ok) {
      toast.success("تنظیمات ذخیره شد و در حسابرسی ثبت گردید.");
      setSettings(result.data);
      setReloadToken((t) => t + 1);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Usage report */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4 text-primary" aria-hidden="true" />
              گزارش مصرف کل سامانه
            </CardTitle>
            <CardDescription className="text-xs">
              مصرف واقعی مرکز فایل به تفکیک دپارتمان و اپراتور، با نوار پیشرفت سهمیه‌ها.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && !usage ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : usage ? (
              <StorageUsageView report={usage} />
            ) : (
              <p className="text-sm text-muted-foreground">
                گزارش مصرف برای حساب شما در دسترس نیست (نیازمند مجوز مدیریت سهمیه‌ها).
              </p>
            )}
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-primary" aria-hidden="true" />
              ظرفیت‌ها، سهمیه‌ها و آنتی‌ویروس
            </CardTitle>
            <CardDescription className="text-xs">
              زنجیره «حد هر فایل ≤ سهمیه اپراتور ≤ سهمیه دپارتمان ≤ ظرفیت کل» در ذخیره‌سازی اعتبارسنجی می‌شود.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && !settings ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : settings ? (
              <>
                <StorageSettingsFields view={settings} onChange={setSettings} />
                {canEdit ? (
                  <Button onClick={() => void handleSave()} disabled={saving}>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {saving ? "در حال ذخیره…" : "ذخیره تنظیمات"}
                  </Button>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    برای تغییر تنظیمات، مجوز «admin.storage.manage» لازم است.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                تنظیمات برای حساب شما در دسترس نیست.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
