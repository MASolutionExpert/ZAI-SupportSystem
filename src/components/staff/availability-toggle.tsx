"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PowerCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";

export function AvailabilityToggle({
  initialAvailable,
  accountActive,
}: {
  initialAvailable: boolean;
  accountActive: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [available, setAvailable] = useState(initialAvailable);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setSaving(true);
    const res = await apiFetch("/api/staff/availability", apiJson("POST", { isAvailable: next }));
    setSaving(false);

    if (!res.ok) {
      toast({ title: "ثبت وضعیت ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setAvailable(next);
    toast({
      title: next ? "برای ارجاع در دسترس هستید" : "از چرخه ارجاع خارج شدید",
    });
    router.refresh();
  }

  if (!accountActive) {
    return (
      <p className="text-xs text-muted-foreground">
        حساب شما غیرفعال است — وضعیت ارجاع قابل تغییر نیست.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm">
        {available ? (
          <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" aria-hidden="true" />
        ) : (
          <PowerCircle className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
        )}
        <div>
          <p className="font-medium">{available ? "در دسترس برای ارجاع" : "خارج از چرخه ارجاع"}</p>
          <p className="text-xs text-muted-foreground">
            موتور توزیع عادلانه تیکت (فاز ۴) این وضعیت را ملاک ارجاع قرار می‌دهد.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        <Switch
          checked={available}
          onCheckedChange={(v) => toggle(v)}
          disabled={saving}
          aria-label="تغییر در دسترس بودن"
        />
      </div>
    </div>
  );
}
