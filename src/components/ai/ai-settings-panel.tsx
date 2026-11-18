"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BotMessageSquare,
  CheckCircle2,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import { faDateTimeFormat, faNum } from "@/lib/format";
import { AI_PROVIDER_TYPE_LABELS, type AiProviderType } from "@/lib/ai/types";

// ------------------------------------------------------------------- types --

export type AiDepartmentRow = {
  id: string;
  name: string;
  aiEnabled: boolean;
};

type AiGlobalSettingsView = {
  enabled: boolean;
  providerType: AiProviderType;
  chatModel: string;
  embeddingModel: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  apiKeySet: boolean;
  apiKeyMasked: string | null;
  updatedAt: string | null;
};

type DepartmentSettings = {
  minConfidence: number;
  escalationOffer: boolean;
  fallbackMessage: string | null;
  dailyMessageLimit: number | null;
};

type DepartmentSettingsView = {
  departmentId: string;
  departmentName: string;
  aiEnabled: boolean;
  settings: DepartmentSettings;
};

type TestResult = {
  ok: boolean;
  provider: AiProviderType;
  detail: string;
  models: string[];
  latencyMs: number;
};

type UsageTotals = {
  requests: number;
  answered: number;
  abstained: number;
  handoff: number;
  errors: number;
  avgLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
};

type UsageRecent = {
  id: string;
  departmentId: string | null;
  departmentName: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  outcome: string;
  createdAt: string;
};

type UsagePayload = {
  days: number;
  totals: UsageTotals;
  byDepartment: { departmentId: string; departmentName: string | null; requests: number }[];
  recent: UsageRecent[];
};

const OUTCOME_META: Record<
  string,
  { label: string; className?: string; variant: "outline" | "secondary" | "destructive" }
> = {
  ANSWERED: {
    label: "پاسخ",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    variant: "outline",
  },
  ABSTAINED: {
    label: "پاسخ‌ندادن",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    variant: "outline",
  },
  HANDOFF: { label: "ارجاع", variant: "secondary" },
  ERROR: { label: "خطا", variant: "destructive" },
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const meta = OUTCOME_META[outcome];
  if (!meta) return <Badge variant="outline">{outcome}</Badge>;
  return <Badge variant={meta.variant} className={meta.className}>{meta.label}</Badge>;
}

function AiLockedCard({ note }: { note: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">بخش قفل است</p>
        <p className="max-w-md text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------- panel --

export function AiSettingsPanel({
  canAccess,
  canConfigure,
  canCredentials,
  canTest,
  canDept,
  canUsage,
  departments,
}: {
  canAccess: boolean;
  canConfigure: boolean;
  canCredentials: boolean;
  canTest: boolean;
  canDept: boolean;
  canUsage: boolean;
  departments: AiDepartmentRow[];
}) {
  return (
    <div className="space-y-6">
      <GlobalSettingsCard canAccess={canAccess} canConfigure={canConfigure} canCredentials={canCredentials} />
      <TestConnectionCard canTest={canTest} />
      <DepartmentSettingsCard canAccess={canAccess} canDept={canDept} departments={departments} />
      <UsageCard canUsage={canUsage} />
    </div>
  );
}

// -------------------------------------------------------- global settings --

function GlobalSettingsCard({
  canAccess,
  canConfigure,
  canCredentials,
}: {
  canAccess: boolean;
  canConfigure: boolean;
  canCredentials: boolean;
}) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AiGlobalSettingsView | null>(null);
  const [loading, setLoading] = useState(canAccess);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [providerType, setProviderType] = useState<AiProviderType>("builtin");
  const [baseUrl, setBaseUrl] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState("700");
  const [timeoutMs, setTimeoutMs] = useState("30000");
  const [apiKeyInput, setApiKeyInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await apiFetch<AiGlobalSettingsView>("/api/admin/ai/settings");
    setLoading(false);
    if (!res.ok) {
      setLoadError(res.error);
      toast({ title: "خطا در دریافت تنظیمات هوش مصنوعی", description: res.error, variant: "destructive" });
      return;
    }
    const data = res.data;
    setSettings(data);
    setEnabled(data.enabled);
    setProviderType(data.providerType);
    setBaseUrl(data.baseUrl);
    setChatModel(data.chatModel);
    setEmbeddingModel(data.embeddingModel);
    setTemperature(data.temperature);
    setMaxTokens(String(data.maxTokens));
    setTimeoutMs(String(data.timeoutMs));
  }, [toast]);

  useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<AiGlobalSettingsView>("/api/admin/ai/settings");
      if (cancelled) return;
      if (!res.ok) {
        setLoadError(res.error);
        setLoading(false);
        toast({ title: "خطا در دریافت تنظیمات هوش مصنوعی", description: res.error, variant: "destructive" });
        return;
      }
      const data = res.data;
      setSettings(data);
      setEnabled(data.enabled);
      setProviderType(data.providerType);
      setBaseUrl(data.baseUrl);
      setChatModel(data.chatModel);
      setEmbeddingModel(data.embeddingModel);
      setTemperature(data.temperature);
      setMaxTokens(String(data.maxTokens));
      setTimeoutMs(String(data.timeoutMs));
      setLoadError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canAccess, toast]);

  async function handleSave() {
    const parsedMaxTokens = Number(maxTokens);
    if (!Number.isInteger(parsedMaxTokens) || parsedMaxTokens < 50 || parsedMaxTokens > 4000) {
      toast({ title: "حد توکن پاسخ باید عدد صحیحی بین ۵۰ تا ۴۰۰۰ باشد.", variant: "destructive" });
      return;
    }
    const parsedTimeout = Number(timeoutMs);
    if (!Number.isInteger(parsedTimeout) || parsedTimeout < 5000 || parsedTimeout > 120000) {
      toast({ title: "زمان انتظار باید عدد صحیحی بین ۵۰۰۰ تا ۱۲۰۰۰۰ میلی‌ثانیه باشد.", variant: "destructive" });
      return;
    }
    if (providerType === "openai-compatible") {
      if (!/^https?:\/\//i.test(baseUrl.trim())) {
        toast({ title: "آدرس Base URL معتبر لازم است.", variant: "destructive" });
        return;
      }
      if (!chatModel.trim()) {
        toast({ title: "انتخاب مدل گفتگو برای این سرویس لازم است.", variant: "destructive" });
        return;
      }
      if (!settings?.apiKeySet && !apiKeyInput.trim()) {
        toast({ title: "کلید API لازم است.", variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      enabled,
      providerType,
      baseUrl: baseUrl.trim(),
      chatModel: chatModel.trim(),
      embeddingModel: embeddingModel.trim(),
      temperature,
      maxTokens: parsedMaxTokens,
      timeoutMs: parsedTimeout,
    };
    if (canCredentials && apiKeyInput.trim()) {
      payload.apiKey = apiKeyInput.trim();
    }
    const res = await apiFetch<AiGlobalSettingsView>(
      "/api/admin/ai/settings",
      apiJson("PUT", payload)
    );
    setSaving(false);
    if (!res.ok) {
      toast({ title: "ذخیره تنظیمات ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    const data = res.data;
    setSettings(data);
    setEnabled(data.enabled);
    setProviderType(data.providerType);
    setBaseUrl(data.baseUrl);
    setChatModel(data.chatModel);
    setEmbeddingModel(data.embeddingModel);
    setTemperature(data.temperature);
    setMaxTokens(String(data.maxTokens));
    setTimeoutMs(String(data.timeoutMs));
    setApiKeyInput("");
    toast({ title: "تنظیمات ذخیره شد" });
  }

  if (!canAccess) {
    return (
      <AiLockedCard note="مشاهده تنظیمات سراسری هوش مصنوعی نیاز به مجوز ai.settings.access دارد." />
    );
  }

  const openAi = providerType === "openai-compatible";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BotMessageSquare className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
          تنظیمات سراسری دستیار هوشمند
        </CardTitle>
        <CardDescription className="text-xs">
          ارائه‌دهنده سرویس، مدل‌ها و پارامترهای پاسخ‌گویی در سطح کل سامانه.
          {settings?.updatedAt ? ` آخرین به‌روزرسانی: ${faDateTimeFormat(settings.updatedAt)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              تلاش مجدد
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {!canConfigure ? (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                تنها مشاهده: مجوز ویرایش ندارید.
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="ai-enabled" className="text-sm">
                  فعال‌سازی دستیار هوشمند در سطح سامانه
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  کلید قطع کلی؛ مستقل از تنظیمات دپارتمان‌ها.
                </p>
              </div>
              <Switch
                id="ai-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canConfigure}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-provider">ارائه‌دهنده سرویس</Label>
              <Select
                value={providerType}
                onValueChange={(v) => setProviderType(v as AiProviderType)}
                disabled={!canConfigure}
              >
                <SelectTrigger id="ai-provider" className="w-full sm:w-80" aria-label="ارائه‌دهنده سرویس">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">{AI_PROVIDER_TYPE_LABELS.builtin}</SelectItem>
                  <SelectItem value="openai-compatible">
                    {AI_PROVIDER_TYPE_LABELS["openai-compatible"]}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {openAi ? (
              <div className="space-y-4 rounded-lg border p-3">
                <div className="space-y-2">
                  <Label htmlFor="ai-base-url">Base URL</Label>
                  <Input
                    id="ai-base-url"
                    dir="ltr"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    disabled={!canConfigure}
                    className="text-left"
                  />
                </div>

                {canCredentials ? (
                  <div className="space-y-2">
                    <Label htmlFor="ai-api-key">کلید API</Label>
                    <Input
                      id="ai-api-key"
                      type="password"
                      dir="ltr"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={
                        settings?.apiKeySet
                          ? (settings.apiKeyMasked ?? "کلید ذخیره‌شده")
                          : "کلید API را وارد کنید"
                      }
                      disabled={!canConfigure}
                      autoComplete="new-password"
                      className="text-left"
                    />
                    <p className="text-xs text-muted-foreground">
                      برای حفظ کلید فعلی، این فیلد را خالی بگذارید. کلید پیش از ذخیره‌سازی رمزنگاری می‌شود.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-api-key-masked">کلید API</Label>
                    <Input
                      id="ai-api-key-masked"
                      dir="ltr"
                      value={settings?.apiKeyMasked ?? (settings?.apiKeySet ? "ذخیره‌شده" : "تنظیم‌نشده")}
                      readOnly
                      className="text-left"
                    />
                    <p className="text-xs text-muted-foreground">
                      به‌روزرسانی کلید نیازمند مجوز ai.credentials.update است.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai-chat-model">مدل گفتگو</Label>
                <Input
                  id="ai-chat-model"
                  dir="ltr"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  placeholder={openAi ? "gpt-4o-mini" : "zai-builtin"}
                  disabled={!canConfigure}
                  className="text-left"
                />
                <p className="text-xs text-muted-foreground">
                  {openAi ? "برای سرویس سازگار با OpenAI الزامی است." : "سرویس داخلی از مدل پیش‌فرض استفاده می‌کند."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-embedding-model">مدل امبدینگ (اختیاری)</Label>
                <Input
                  id="ai-embedding-model"
                  dir="ltr"
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  disabled={!canConfigure}
                  className="text-left"
                />
                <p className="text-xs text-muted-foreground">
                  خالی = جست‌وجوی معنایی خاموش؛ جست‌وجوی کلیدواژه‌ای همیشه فعال است.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-temperature">دمای پاسخ (Temperature)</Label>
                  <span className="text-sm font-medium" dir="ltr">
                    {faNum(temperature.toFixed(1))}
                  </span>
                </div>
                <Slider
                  id="ai-temperature"
                  min={0}
                  max={2}
                  step={0.1}
                  value={[temperature]}
                  onValueChange={(v) => setTemperature(v[0] ?? temperature)}
                  disabled={!canConfigure}
                  aria-label="دمای پاسخ"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ai-max-tokens">حد توکن پاسخ</Label>
                  <Input
                    id="ai-max-tokens"
                    dir="ltr"
                    type="number"
                    min={50}
                    max={4000}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    disabled={!canConfigure}
                    className="text-left"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-timeout">زمان انتظار</Label>
                  <Input
                    id="ai-timeout"
                    dir="ltr"
                    type="number"
                    min={5000}
                    max={120000}
                    step={1000}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(e.target.value)}
                    disabled={!canConfigure}
                    className="text-left"
                  />
                  <p className="text-xs text-muted-foreground">میلی‌ثانیه.</p>
                </div>
              </div>
            </div>

            {canConfigure ? (
              <div className="flex justify-end">
                <Button onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                  ذخیره تنظیمات
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------ test connection --

function TestConnectionCard({ canTest }: { canTest: boolean }) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  if (!canTest) return null;

  async function runTest() {
    setTesting(true);
    setResult(null);
    const res = await apiFetch<TestResult>("/api/admin/ai/test-connection", {
      method: "POST",
    });
    setTesting(false);
    if (!res.ok) {
      toast({ title: "اجرای تست اتصال ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setResult(res.data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
          تست اتصال به سرویس
        </CardTitle>
        <CardDescription className="text-xs">
          بررسی سلامت ارائه‌دهنده فعال با تنظیمات ذخیره‌شده؛ جزئیات بدون افشای اطلاعات حساس نمایش داده می‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Button onClick={() => void runTest()} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
            تست اتصال
          </Button>
        </div>

        {result ? (
          result.ok ? (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>اتصال موفق</AlertTitle>
              <AlertDescription className="text-emerald-800">
                <p>{result.detail}</p>
                <p className="mt-1 text-xs">
                  {faNum(result.models.length)} مدل در دسترس — تأخیر: {faNum(result.latencyMs)} میلی‌ثانیه
                </p>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>اتصال ناموفق</AlertTitle>
              <AlertDescription>
                <p>{result.detail}</p>
                <p className="mt-1 text-xs">تأخیر تا خطا: {faNum(result.latencyMs)} میلی‌ثانیه</p>
              </AlertDescription>
            </Alert>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------- department settings --

function DepartmentSettingsCard({
  canAccess,
  canDept,
  departments,
}: {
  canAccess: boolean;
  canDept: boolean;
  departments: AiDepartmentRow[];
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Record<string, DepartmentSettingsView | null>>({});
  const [loading, setLoading] = useState(canDept || canAccess);
  const [editing, setEditing] = useState<AiDepartmentRow | null>(null);
  const [form, setForm] = useState({
    aiEnabled: true,
    minConfidence: 0.35,
    escalationOffer: true,
    fallbackMessage: "",
    dailyMessageLimit: "",
  });
  const [saving, setSaving] = useState(false);
  const [dialogLoading, setDialogLoading] = useState(false);

  useEffect(() => {
    if (!canDept && !canAccess) return;
    let cancelled = false;
    (async () => {
      if (departments.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }
      const results = await Promise.all(
        departments.map(async (department) => {
          const res = await apiFetch<DepartmentSettingsView>(
            `/api/admin/ai/department-settings?departmentId=${encodeURIComponent(department.id)}`
          );
          return [department.id, res.ok ? res.data : null] as const;
        })
      );
      if (cancelled) return;
      const map: Record<string, DepartmentSettingsView | null> = {};
      for (const [id, view] of results) map[id] = view;
      setRows(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canDept, canAccess, departments]);

  async function openEdit(department: AiDepartmentRow) {
    setEditing(department);
    setDialogLoading(true);
    setForm({
      aiEnabled: department.aiEnabled,
      minConfidence: 0.35,
      escalationOffer: true,
      fallbackMessage: "",
      dailyMessageLimit: "",
    });
    const res = await apiFetch<DepartmentSettingsView>(
      `/api/admin/ai/department-settings?departmentId=${encodeURIComponent(department.id)}`
    );
    setDialogLoading(false);
    if (!res.ok) {
      toast({ title: "خواندن تنظیمات دپارتمان ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setForm({
      aiEnabled: res.data.aiEnabled,
      minConfidence: res.data.settings.minConfidence,
      escalationOffer: res.data.settings.escalationOffer,
      fallbackMessage: res.data.settings.fallbackMessage ?? "",
      dailyMessageLimit:
        res.data.settings.dailyMessageLimit === null ? "" : String(res.data.settings.dailyMessageLimit),
    });
  }

  async function handleSave() {
    if (!editing) return;
    const trimmedFallback = form.fallbackMessage.trim();
    if (trimmedFallback && trimmedFallback.length < 3) {
      toast({ title: "پیام جایگزین باید حداقل ۳ کاراکتر باشد.", variant: "destructive" });
      return;
    }
    let dailyLimit: number | null = null;
    if (form.dailyMessageLimit.trim()) {
      const parsed = Number(form.dailyMessageLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
        toast({ title: "سهمیه روزانه باید عدد صحیحی بین ۱ تا ۱۰۰۰ باشد.", variant: "destructive" });
        return;
      }
      dailyLimit = parsed;
    }

    setSaving(true);
    const res = await apiFetch<DepartmentSettingsView>(
      "/api/admin/ai/department-settings",
      apiJson("PUT", {
        departmentId: editing.id,
        aiEnabled: form.aiEnabled,
        minConfidence: form.minConfidence,
        escalationOffer: form.escalationOffer,
        fallbackMessage: trimmedFallback || null,
        dailyMessageLimit: dailyLimit,
      })
    );
    setSaving(false);
    if (!res.ok) {
      toast({ title: "ذخیره تنظیمات دپارتمان ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setRows((prev) => ({ ...prev, [editing.id]: res.data }));
    setEditing(null);
    toast({ title: "تنظیمات دپارتمان ذخیره شد" });
  }

  if (!canDept && !canAccess) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
          تنظیمات هوش مصنوعی دپارتمان‌ها
        </CardTitle>
        <CardDescription className="text-xs">
          سوییچ فعال‌سازی، حداقل اطمینان پاسخ، پیشنهاد ارجاع، پیام جایگزین و سهمیه روزانه هر دپارتمان.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">دپارتمان فعالی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>دپارتمان</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>حداقل اطمینان</TableHead>
                  <TableHead>پیشنهاد ارجاع</TableHead>
                  <TableHead>سهمیه روزانه</TableHead>
                  {canDept ? <TableHead className="text-start">عملیات</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((department) => {
                  const row = rows[department.id];
                  return (
                    <TableRow key={department.id}>
                      <TableCell className="font-medium">{department.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            (row ? row.aiEnabled : department.aiEnabled)
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "text-muted-foreground"
                          }
                        >
                          {(row ? row.aiEnabled : department.aiEnabled) ? "فعال" : "غیرفعال"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row ? faNum(row.settings.minConfidence.toFixed(2)) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row ? (row.settings.escalationOffer ? "بله" : "خیر") : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row
                          ? row.settings.dailyMessageLimit === null
                            ? "بی‌نهایت"
                            : faNum(row.settings.dailyMessageLimit)
                          : "—"}
                      </TableCell>
                      {canDept ? (
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openEdit(department)}
                          >
                            ویرایش تنظیمات
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ویرایش تنظیمات AI دپارتمان</DialogTitle>
            <DialogDescription>
              {editing ? `رفتار دستیار هوشمند برای دپارتمان «${editing.name}»` : ""}
            </DialogDescription>
          </DialogHeader>
          {dialogLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <Label htmlFor="ai-dept-enabled" className="text-sm">
                  فعال‌سازی دستیار برای این دپارتمان
                </Label>
                <Switch
                  id="ai-dept-enabled"
                  checked={form.aiEnabled}
                  onCheckedChange={(v) => setForm({ ...form, aiEnabled: v })}
                />
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-dept-min-confidence">حداقل اطمینان پاسخ</Label>
                  <span className="text-sm font-medium" dir="ltr">
                    {faNum(form.minConfidence.toFixed(2))}
                  </span>
                </div>
                <Slider
                  id="ai-dept-min-confidence"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={[form.minConfidence]}
                  onValueChange={(v) => setForm({ ...form, minConfidence: v[0] ?? form.minConfidence })}
                  aria-label="حداقل اطمینان پاسخ"
                />
                <p className="text-xs text-muted-foreground">
                  پایین‌تر از این سطح → پاسخ نمی‌دهد و به اپراتور ارجاع می‌دهد.
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <Label htmlFor="ai-dept-escalation" className="text-sm">
                    پیشنهاد ارجاع به اپراتور پس از پاسخ‌ندادن
                  </Label>
                </div>
                <Switch
                  id="ai-dept-escalation"
                  checked={form.escalationOffer}
                  onCheckedChange={(v) => setForm({ ...form, escalationOffer: v })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-dept-fallback">پیام جایگزین (اختیاری)</Label>
                <Textarea
                  id="ai-dept-fallback"
                  value={form.fallbackMessage}
                  onChange={(e) => setForm({ ...form, fallbackMessage: e.target.value })}
                  placeholder="متن استاندارد سامانه"
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">خالی = پیام استاندارد.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-dept-limit">سهمیه پیام روزانه (اختیاری)</Label>
                <Input
                  id="ai-dept-limit"
                  dir="ltr"
                  type="number"
                  min={1}
                  max={1000}
                  value={form.dailyMessageLimit}
                  onChange={(e) => setForm({ ...form, dailyMessageLimit: e.target.value })}
                  placeholder="بی‌نهایت"
                  className="text-left"
                />
                <p className="text-xs text-muted-foreground">خالی = بی‌نهایت.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || dialogLoading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ------------------------------------------------------------------ usage --

function UsageCard({ canUsage }: { canUsage: boolean }) {
  const { toast } = useToast();
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(canUsage);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<UsagePayload>("/api/admin/ai/usage?days=7");
    if (res.ok) {
      setUsage(res.data);
    } else {
      setUsage(null);
      toast({ title: "خطا در دریافت گزارش مصرف", description: res.error, variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    if (!canUsage) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<UsagePayload>("/api/admin/ai/usage?days=7");
      if (cancelled) return;
      if (res.ok) setUsage(res.data);
      else toast({ title: "خطا در دریافت گزارش مصرف", description: res.error, variant: "destructive" });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canUsage, toast]);

  if (!canUsage) return null;

  function refresh() {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }

  const totals = usage?.totals;
  const totalTokens = totals ? totals.promptTokens + totals.completionTokens : 0;

  const kpis = totals
    ? [
        { label: "کل درخواست‌ها", value: faNum(totals.requests) },
        { label: "پاسخ داده‌شده", value: faNum(totals.answered) },
        { label: "پاسخ‌ندادن", value: faNum(totals.abstained) },
        { label: "ارجاع به اپراتور", value: faNum(totals.handoff) },
        { label: "خطاها", value: faNum(totals.errors) },
        { label: "میانگین تأخیر", value: `${faNum(totals.avgLatencyMs)} میلی‌ثانیه` },
        { label: "مجموع توکن‌ها", value: faNum(totalTokens) },
      ]
    : [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            گزارش مصرف هفت روز اخیر
          </CardTitle>
          <CardDescription className="text-xs">
            مجموع درخواست‌ها، نتیجه هر تماس و تأخیر سرویس هوش مصنوعی.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} aria-label="بازخوانی گزارش مصرف">
          <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" />
          بازخوانی
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : !usage || !totals ? (
          <p className="text-sm text-muted-foreground">گزارشی برای نمایش وجود ندارد.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((kpi) => (
                <div key={kpi.label} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p className="mt-1 text-lg font-bold">{kpi.value}</p>
                </div>
              ))}
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">تفکیک توکن‌ها</p>
                <p className="mt-1 text-xs" dir="ltr">
                  prompt {faNum(totals.promptTokens)} / completion {faNum(totals.completionTokens)}
                </p>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">آخرین تماس‌ها (۲۵ مورد)</h4>
              {usage.recent.length === 0 ? (
                <p className="text-xs text-muted-foreground">در این بازه تماسی ثبت نشده است.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>دپارتمان</TableHead>
                        <TableHead>مدل</TableHead>
                        <TableHead>نتیجه</TableHead>
                        <TableHead>توکن‌ها</TableHead>
                        <TableHead>تأخیر</TableHead>
                        <TableHead>زمان</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usage.recent.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm">
                            {row.departmentName ?? "—"}
                          </TableCell>
                          <TableCell dir="ltr" className="text-start text-xs text-muted-foreground">
                            {row.model || row.provider}
                          </TableCell>
                          <TableCell>
                            <OutcomeBadge outcome={row.outcome} />
                          </TableCell>
                          <TableCell className="text-sm">
                            {faNum(row.promptTokens + row.completionTokens)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {faNum(row.latencyMs)} میلی‌ثانیه
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {faDateTimeFormat(row.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
