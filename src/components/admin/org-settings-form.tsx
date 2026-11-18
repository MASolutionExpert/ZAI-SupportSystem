"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, HardDrive, Info, Save, Settings, BotMessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import { faDateTimeFormat, faNum } from "@/lib/format";

type SettingsMeta = { updatedBy: string | null; updatedAt: string | null } | null;

type SettingsPayload = {
  values: { orgName: string; orgTagline: string; orgSupportIntro: string };
  meta: { orgName: SettingsMeta; orgTagline: SettingsMeta; orgSupportIntro: SettingsMeta };
};

export function OrgSettingsForm() {
  const { toast } = useToast();
  const [initial, setInitial] = useState<SettingsPayload | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgTagline, setOrgTagline] = useState("");
  const [orgSupportIntro, setOrgSupportIntro] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const result = await apiFetch<SettingsPayload>("/api/admin/settings");
      setLoading(false);
      if (cancelled) return;
      if (result.ok) {
        setInitial(result.data);
        setOrgName(result.data.values.orgName);
        setOrgTagline(result.data.values.orgTagline);
        setOrgSupportIntro(result.data.values.orgSupportIntro);
      } else {
        toast({ title: "خطا در دریافت تنظیمات", description: result.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, toast]);

  const dirty =
    !!initial &&
    (orgName !== initial.values.orgName ||
      orgTagline !== initial.values.orgTagline ||
      orgSupportIntro !== initial.values.orgSupportIntro);

  async function handleSave() {
    if (!orgName.trim()) return;
    setSaving(true);
    const result = await apiFetch<{ changedKeys: string[]; values: SettingsPayload["values"] }>(
      "/api/admin/settings",
      apiJson("PUT", {
        orgName: orgName.trim(),
        orgTagline: orgTagline.trim(),
        orgSupportIntro: orgSupportIntro.trim(),
      })
    );
    setSaving(false);
    if (result.ok) {
      const changed = result.data.changedKeys.length;
      toast({
        title: "تنظیمات ذخیره شد",
        description:
          changed > 0
            ? `${faNum(changed)} مقدار به‌روزرسانی شد و در حسابرسی ثبت شد. تغییرات بلافاصله در صفحات عمومی اعمال می‌شود.`
            : "هیچ تغییری اعمال نشد.",
      });
      setReloadToken((t) => t + 1);
    } else {
      toast({ title: "ذخیره ناموفق بود", description: result.error, variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-primary" aria-hidden="true" />
            تنظیمات سازمانی
          </CardTitle>
          <CardDescription className="text-xs">
            مقادیر زیر در سراسر سامانه — صفحه اصلی عمومی، پورتال مراجعان، صفحه ورود و متن معرفی
            گفتگو — استفاده می‌شوند. هر تغییر در گزارش حسابرسی ثبت می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="org-name">نام سازمان</Label>
              <span className="text-[11px] text-muted-foreground">
                {faNum(orgName.length)} / ۸۰
              </span>
            </div>
            <Input
              id="org-name"
              value={orgName}
              maxLength={80}
              onChange={(e) => setOrgName(e.target.value)}
              aria-describedby="org-name-hint"
            />
            <p id="org-name-hint" className="text-[11px] text-muted-foreground">
              در عنوان صفحه اصلی، پورتال مراجعان، صفحه ورود و پیام‌های سیستم گفتگو نمایش داده می‌شود.
            </p>
            {initial?.meta.orgName?.updatedAt ? (
              <p className="text-[11px] text-muted-foreground">
                آخرین تغییر: {faDateTimeFormat(initial.meta.orgName.updatedAt)}
                {initial.meta.orgName.updatedBy ? ` توسط @${initial.meta.orgName.updatedBy}` : ""}
              </p>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="org-tagline">شعار سازمان</Label>
              <span className="text-[11px] text-muted-foreground">
                {faNum(orgTagline.length)} / ۱۲۰
              </span>
            </div>
            <Input
              id="org-tagline"
              value={orgTagline}
              maxLength={120}
              onChange={(e) => setOrgTagline(e.target.value)}
              aria-describedby="org-tagline-hint"
            />
            <p id="org-tagline-hint" className="text-[11px] text-muted-foreground">
              زیر نام سازمان در صفحه اصلی عمومی نمایش داده می‌شود.
            </p>
            {initial?.meta.orgTagline?.updatedAt ? (
              <p className="text-[11px] text-muted-foreground">
                آخرین تغییر: {faDateTimeFormat(initial.meta.orgTagline.updatedAt)}
                {initial.meta.orgTagline.updatedBy ? ` توسط @${initial.meta.orgTagline.updatedBy}` : ""}
              </p>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="org-intro">متن معرفی پشتیبانی</Label>
              <span className="text-[11px] text-muted-foreground">
                {faNum(orgSupportIntro.length)} / ۳۰۰
              </span>
            </div>
            <Textarea
              id="org-intro"
              value={orgSupportIntro}
              maxLength={300}
              rows={3}
              onChange={(e) => setOrgSupportIntro(e.target.value)}
              aria-describedby="org-intro-hint"
            />
            <p id="org-intro-hint" className="text-[11px] text-muted-foreground">
              متن دعوت به گفتگو در صفحه اصلی و پورتال؛ همچنین به پرامپت سیستم دستیار هوشمند اضافه می‌شود.
            </p>
            {initial?.meta.orgSupportIntro?.updatedAt ? (
              <p className="text-[11px] text-muted-foreground">
                آخرین تغییر: {faDateTimeFormat(initial.meta.orgSupportIntro.updatedAt)}
                {initial.meta.orgSupportIntro.updatedBy ? ` توسط @${initial.meta.orgSupportIntro.updatedBy}` : ""}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void handleSave()} disabled={saving || !orgName.trim() || !dirty}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? "در حال ذخیره…" : "ذخیره تنظیمات"}
            </Button>
            {!dirty && initial ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                همه تغییرات ذخیره شده است.
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Other settings locations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">تنظیمات دیگر</CardTitle>
          <CardDescription className="text-xs">
            تنظیمات تخصصی‌تر در ماژول‌های خودشان مدیریت می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            <li>
              <Link
                href="/admin/storage"
                className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/70"
              >
                <HardDrive className="h-4 w-4 text-primary" aria-hidden="true" />
                مدیریت ذخیره‌سازی — ظرفیت‌ها، سهمیه‌ها و آنتی‌ویروس
              </Link>
            </li>
            <li>
              <Link
                href="/admin/ai"
                className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/70"
              >
                <BotMessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
                تنظیمات هوش مصنوعی — ارائه‌دهنده، مدل و کلید API
              </Link>
            </li>
          </ul>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            تنظیمات امنیتی ورود (حد مجاز تلاش و مدت قفل حساب) از متغیرهای محیطی خوانده می‌شود و
            در صفحه «سلامت سامانه» قابل مشاهده است.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
