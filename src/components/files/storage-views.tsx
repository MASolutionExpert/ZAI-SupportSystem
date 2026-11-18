"use client";

import { ShieldAlert } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { faBytes, faNum } from "@/lib/format";

/**
 * Shared presentational pieces for storage administration — used by the
 * `/files` workspace dialogs and the `/admin/storage` page so the two
 * surfaces never drift apart.
 */

export type UsageReport = {
  total: { usedBytes: number; capacityBytes: number };
  departments: Array<{ id: string; name: string; usedBytes: number; quotaBytes: number; fileCount: number }>;
  operators: Array<{ id: string; name: string; username: string; usedBytes: number; quotaBytes: number }>;
};

export type StorageSettingsView = {
  global: {
    totalCapacityBytes: number;
    defaultDepartmentQuotaBytes: number;
    defaultOperatorQuotaBytes: number;
    maxUploadBytes: number;
    allowedExtensions: string[];
  };
  av: { provider: string; host: string; port: number; timeoutMs: number };
};

export const ALL_STORAGE_EXTENSIONS = ["pdf", "png", "jpg", "webp", "zip", "docx", "txt", "csv"];

/** Full usage report — total capacity bar plus per-department/per-operator rows. */
export function StorageUsageView({ report }: { report: UsageReport | null }) {
  if (!report) return null;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground mb-1">کل سامانه</p>
        <Progress
          value={Math.min(100, Math.round((report.total.usedBytes / Math.max(1, report.total.capacityBytes)) * 100))}
        />
        <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
          {faBytes(report.total.usedBytes)} / {faBytes(report.total.capacityBytes)}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">دپارتمان‌ها</p>
        {report.departments.length === 0 ? (
          <p className="text-xs text-muted-foreground">دپارتمانی یافت نشد.</p>
        ) : (
          <ul className="space-y-2">
            {report.departments.map((d) => (
              <li key={d.id} className="rounded-lg border p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{d.name}</span>
                  <span dir="ltr" className="text-muted-foreground">
                    {faBytes(d.usedBytes)} / {faBytes(d.quotaBytes)} — {faNum(d.fileCount)} فایل
                  </span>
                </div>
                <Progress
                  className="mt-1.5 h-1.5"
                  value={Math.min(100, Math.round((d.usedBytes / Math.max(1, d.quotaBytes)) * 100))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">اپراتورها (بارگذاری‌کننده)</p>
        {report.operators.length === 0 ? (
          <p className="text-xs text-muted-foreground">عضوی در دامنه یافت نشد.</p>
        ) : (
          <ul className="space-y-2">
            {report.operators.map((o) => (
              <li key={o.id} className="rounded-lg border p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    {o.name}{" "}
                    <span dir="ltr" className="text-muted-foreground">
                      @{o.username}
                    </span>
                  </span>
                  <span dir="ltr" className="text-muted-foreground">
                    {faBytes(o.usedBytes)} / {faBytes(o.quotaBytes)}
                  </span>
                </div>
                <Progress
                  className="mt-1.5 h-1.5"
                  value={Math.min(100, Math.round((o.usedBytes / Math.max(1, o.quotaBytes)) * 100))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Controlled settings fields (capacities, allowlist, antivirus) — no chrome. */
export function StorageSettingsFields({
  view,
  onChange,
}: {
  view: StorageSettingsView;
  onChange: (next: StorageSettingsView) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="cap-total">ظرفیت کل (بایت)</Label>
          <Input
            id="cap-total"
            type="number"
            dir="ltr"
            value={view.global.totalCapacityBytes}
            onChange={(e) =>
              onChange({ ...view, global: { ...view.global, totalCapacityBytes: Number(e.target.value) } })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cap-dept">سهمیه پیش‌فرض دپارتمان</Label>
          <Input
            id="cap-dept"
            type="number"
            dir="ltr"
            value={view.global.defaultDepartmentQuotaBytes}
            onChange={(e) =>
              onChange({
                ...view,
                global: { ...view.global, defaultDepartmentQuotaBytes: Number(e.target.value) },
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cap-op">سهمیه پیش‌فرض اپراتور</Label>
          <Input
            id="cap-op"
            type="number"
            dir="ltr"
            value={view.global.defaultOperatorQuotaBytes}
            onChange={(e) =>
              onChange({
                ...view,
                global: { ...view.global, defaultOperatorQuotaBytes: Number(e.target.value) },
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cap-max">حداکثر حجم هر فایل</Label>
          <Input
            id="cap-max"
            type="number"
            dir="ltr"
            value={view.global.maxUploadBytes}
            onChange={(e) =>
              onChange({ ...view, global: { ...view.global, maxUploadBytes: Number(e.target.value) } })
            }
          />
        </div>
      </div>
      <div>
        <Label className="mb-1.5">پسوندهای مجاز</Label>
        <div className="flex flex-wrap gap-2">
          {ALL_STORAGE_EXTENSIONS.map((ext) => {
            const checked = view.global.allowedExtensions.includes(ext);
            return (
              <label
                key={ext}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...view.global.allowedExtensions, ext]
                      : view.global.allowedExtensions.filter((x) => x !== ext);
                    onChange({ ...view, global: { ...view.global, allowedExtensions: next } });
                  }}
                />
                <span dir="ltr">{ext}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          فهرست مجاز فقط می‌تواند محدودکننده باشد؛ انواع قابل تأیید محتوایی: pdf، png، jpg، webp، zip، docx، txt، csv.
        </p>
      </div>
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
          اسکن آنتی‌ویروس (نقطه اتصال ClamAV)
        </p>
        <div className="flex items-center gap-2">
          <Switch
            checked={view.av.provider === "clamav"}
            onCheckedChange={(v) =>
              onChange({ ...view, av: { ...view.av, provider: v ? "clamav" : "none" } })
            }
            aria-label="فعال‌سازی اسکن ClamAV"
          />
          <span className="text-xs">
            {view.av.provider === "clamav"
              ? "فعال — فایل‌های بدون اسکن موفق ذخیره نمی‌شوند (اجبار اسکن)"
              : "غیرفعال — وضعیت «بدون اسکن» صادقانه نمایش داده می‌شود"}
          </span>
        </div>
        {view.av.provider === "clamav" ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1 col-span-2">
              <Label htmlFor="av-host">میزبان clamd</Label>
              <Input
                id="av-host"
                dir="ltr"
                value={view.av.host}
                onChange={(e) => onChange({ ...view, av: { ...view.av, host: e.target.value } })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="av-port">درگاه</Label>
              <Input
                id="av-port"
                type="number"
                dir="ltr"
                value={view.av.port}
                onChange={(e) => onChange({ ...view, av: { ...view.av, port: Number(e.target.value) } })}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
