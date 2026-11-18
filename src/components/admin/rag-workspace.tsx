"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BotMessageSquare,
  FlaskConical,
  HardDrive,
  ListOrdered,
  RefreshCw,
  Save,
  ScrollText,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import { faDateTimeFormat, faNum } from "@/lib/format";

/**
 * RAG engine workspace (task §11) — index health, background jobs, retrieval
 * traces, engine settings and evaluation runs, all without code changes.
 * Provider credentials never appear here (managed in the AI settings page).
 */

type RagOverview = {
  settings: {
    embeddings: { provider: string; model: string; dim?: number };
    retrieval: {
      candidateK: number;
      finalTopK: number;
      rrfK: number;
      lexicalFloor: number;
      semanticFloor: number;
      parentExpansion: boolean;
      parentExpansionLimit: number;
      maxContextChars: number;
    };
    rerank: { mode: string; rerankCandidates: number; llmTimeoutMs: number };
    crag: {
      enabled: boolean;
      maxCorrectiveRounds: number;
      maxLlmCallsPerTurn: number;
      deadlineMs: number;
      partialPromotion: number;
      insufficiencyFloor: number;
      clarifyOnPartial: boolean;
    };
    generation: { verifyCitations: boolean; verifyClaims: boolean; appendCitations: boolean };
  };
  documents: { total: number; indexed: number; processing: number; failed: number; disabled: number; uploaded: number };
  chunks: {
    total: number;
    sections: number;
    paragraphs: number;
    embedded: number;
    embeddingModels: Array<{ model: string; dim: number | null; count: number }>;
  };
  jobs: {
    pending: number;
    running: number;
    failed: number;
    succeeded: number;
    recentFailed: Array<{ id: string; type: string; lastError: string | null; attempts: number; createdAt: string }>;
  };
  traces: {
    total: number;
    answered: number;
    abstain: number;
    clarify: number;
    conflictDetected: number;
    budgetExceeded: number;
    recent: Array<{
      id: string;
      query: string;
      strategy: string;
      decision: string;
      iterations: number;
      llmCalls: number;
      durationMs: number;
      conflictDetected: boolean;
      supersededExcluded: boolean;
      budgetExceeded: boolean;
      createdAt: string;
    }>;
  };
  evalRuns: Array<{ id: string; datasetId: string; engineVersion: string; total: number; passed: number; failed: number; createdAt: string }>;
};

const DECISION_LABELS: Record<string, string> = {
  ANSWERED: "پاسخ مستند",
  CLARIFY: "شفاف‌سازی",
  ABSTAIN: "انصراف",
  ESCALATE: "ارجاع",
};

export function RagWorkspace() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<RagOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jobBusy, setJobBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<RagOverview>("/api/admin/rag");
      if (!result.ok) throw new Error(result.error);
      setOverview(result.data);
    } catch {
      toast({ title: "خطا", description: "دریافت وضعیت موتور دانش ناموفق بود.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateSettings(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      await apiFetch("/api/admin/rag", apiJson("PUT", patch));
      toast({ title: "ذخیره شد", description: "تنظیمات موتور دانش به‌روزرسانی شد." });
      await load();
    } catch (error) {
      toast({
        title: "خطا",
        description: error instanceof Error ? error.message : "به‌روزرسانی تنظیمات ناموفق بود.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function enqueue(action: "reembed-scope" | "reingest-document", extra?: Record<string, unknown>) {
    setJobBusy(true);
    try {
      await apiFetch("/api/admin/rag", apiJson("POST", { action, ...extra }));
      toast({ title: "کار ثبت شد", description: "کار پس‌زمینه در صف پردازش قرار گرفت." });
      setTimeout(() => void load(), 1500);
    } catch (error) {
      toast({
        title: "خطا",
        description: error instanceof Error ? error.message : "ثبت کار ناموفق بود.",
        variant: "destructive",
      });
    } finally {
      setJobBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!overview) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">وضعیت موتور در دسترس نیست.</CardContent></Card>;
  }

  const settings = overview.settings;
  const mismatchedChunks = overview.chunks.total - overview.chunks.embedded;

  return (
    <Tabs defaultValue="overview" className="space-y-4" dir="rtl">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="overview" className="gap-1"><Activity className="h-4 w-4" /> بررسی کلی</TabsTrigger>
        <TabsTrigger value="settings" className="gap-1"><Settings2 className="h-4 w-4" /> تنظیمات موتور</TabsTrigger>
        <TabsTrigger value="traces" className="gap-1"><ScrollText className="h-4 w-4" /> ردگیری‌ها</TabsTrigger>
        <TabsTrigger value="eval" className="gap-1"><FlaskConical className="h-4 w-4" /> ارزیابی</TabsTrigger>
      </TabsList>

      {/* ------------------------------------------------------ overview */}
      <TabsContent value="overview" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">اسناد</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{faNum(overview.documents.total)}</CardContent>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              فهرست‌شده {faNum(overview.documents.indexed)} · در حال پردازش {faNum(overview.documents.processing)} · ناموفق {faNum(overview.documents.failed)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">قطعه‌ها</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{faNum(overview.chunks.total)}</CardContent>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {faNum(overview.chunks.sections)} بخش + {faNum(overview.chunks.paragraphs)} قطعه فرزند · امبد‌شده {faNum(overview.chunks.embedded)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">ترنزاکشن‌های بازیابی</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{faNum(overview.traces.total)}</CardContent>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              پاسخ {faNum(overview.traces.answered)} · انصراف {faNum(overview.traces.abstain)} · شفاف‌سازی {faNum(overview.traces.clarify)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">صف کارها</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{faNum(overview.jobs.pending + overview.jobs.running)}</CardContent>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              موفق {faNum(overview.jobs.succeeded)} · ناموفق {faNum(overview.jobs.failed)}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><HardDrive className="h-4 w-4" /> ایندکس امبدینگ</CardTitle>
            <CardDescription>
              {mismatchedChunks > 0
                ? `${faNum(mismatchedChunks)} قطعه با مدل امبدینگ جاری ناسازگار است (در جستجوی برداری مشارکت نمی‌کنند) — امبدینگ مجدد را اجرا کنید.`
                : "همه قطعه‌ها با مدل امبدینگ جاری هم‌خوان‌اند."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.chunks.embeddingModels.length === 0 ? (
              <p className="text-sm text-muted-foreground">هیچ برداری ذخیره نشده است.</p>
            ) : (
              overview.chunks.embeddingModels.map((row) => (
                <div key={`${row.model}-${row.dim}`} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span className="font-medium">{row.model}</span>
                  <span className="text-muted-foreground">ابعاد: {row.dim ? faNum(row.dim) : "؟"}</span>
                  <Badge variant="secondary">{faNum(row.count)} قطعه</Badge>
                </div>
              ))
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" disabled={jobBusy} onClick={() => enqueue("reembed-scope", { all: true })}>
                <RefreshCw className="h-4 w-4" /> امبدینگ مجدد کل مخزن
              </Button>
              <Button size="sm" variant="outline" disabled={jobBusy} onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" /> بازخوانی وضعیت
              </Button>
            </div>
          </CardContent>
        </Card>

        {overview.jobs.recentFailed.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">کارهای ناموفق اخیر</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {overview.jobs.recentFailed.map((job) => (
                <div key={job.id} className="rounded-md border border-destructive/40 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{job.type}</span>
                    <span>{faDateTimeFormat(job.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-destructive">{job.lastError ?? "خطای نامشخص"} (تلاش {faNum(job.attempts)})</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ------------------------------------------------------ settings */}
      <TabsContent value="settings" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><BotMessageSquare className="h-4 w-4" /> پیکربندی موتور</CardTitle>
            <CardDescription>اعمال تنظیمات بدون نیاز به راه‌اندازی مجدد؛ مدل امبدینگ جدید با «امبدینگ مجدد کل مخزن» در تب بررسی کلی اعمال می‌شود.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="emb-model">مدل امبدینگ</Label>
              <Input id="emb-model" defaultValue={settings.embeddings.model} readOnly />
              <p className="text-xs text-muted-foreground">ارائه‌دهنده فعلی: {settings.embeddings.provider === "builtin-hashed" ? "داخلی قطعی (بدون شبکه)" : "سازگار با OpenAI"}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rrf">ثابت RRF (k)</Label>
              <Input id="rrf" type="number" min={10} max={120} defaultValue={settings.retrieval.rrfK} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cand">تعداد کاندید هر بازیابی</Label>
              <Input id="cand" type="number" min={5} max={80} defaultValue={settings.retrieval.candidateK} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="topk">تعداد مدارک نهایی</Label>
              <Input id="topk" type="number" min={1} max={12} defaultValue={settings.retrieval.finalTopK} readOnly />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="rerank">لایه رتبه‌بندی مجدد</Label>
                <p className="text-xs text-muted-foreground">heuristic = قطعی و رایگان؛ llm = داوری معنایی مدل (هزینه‌دار)</p>
              </div>
              <div className="flex gap-1">
                {(["off", "heuristic", "llm"] as const).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={settings.rerank.mode === mode ? "default" : "outline"}
                    disabled={saving}
                    onClick={() => updateSettings({ rerank: { mode } })}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="crag">کنترلر CRAG (اصلاح بازیابی)</Label>
                <p className="text-xs text-muted-foreground">حداکثر {faNum(settings.crag.maxCorrectiveRounds)} دور اصلاحی، {faNum(settings.crag.maxLlmCallsPerTurn)} فراخوان مدل، بودجه {faNum(Math.round(settings.crag.deadlineMs / 1000))} ثانیه</p>
              </div>
              <Switch id="crag" checked={settings.crag.enabled} onCheckedChange={(checked) => updateSettings({ crag: { enabled: checked } })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="parent">گسترش والد قطعه‌ها</Label>
              <Switch id="parent" checked={settings.retrieval.parentExpansion} onCheckedChange={(checked) => updateSettings({ retrieval: { parentExpansion: checked } })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><Label htmlFor="cite">اعتبارسنجی ارجاع‌ها</Label><p className="text-xs text-muted-foreground">ارجاع پاسخ باید به مدارک بازیابی‌شده تعلق داشته باشد</p></div>
              <Switch id="cite" checked={settings.generation.verifyCitations} onCheckedChange={(checked) => updateSettings({ generation: { verifyCitations: checked } })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><Label htmlFor="claims">راستی‌آزمایی گزاره‌ها</Label><p className="text-xs text-muted-foreground">غربال گزاره‌های بدون پشتوانه پیش از نمایش پاسخ</p></div>
              <Switch id="claims" checked={settings.generation.verifyClaims} onCheckedChange={(checked) => updateSettings({ generation: { verifyClaims: checked } })} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><Label htmlFor="appcite">درج منابع زیر پاسخ</Label><p className="text-xs text-muted-foreground">نمایش مراجع امن مشتری (عنوان/صفحه/بخش)</p></div>
              <Switch id="appcite" checked={settings.generation.appendCitations} onCheckedChange={(checked) => updateSettings({ generation: { appendCitations: checked } })} />
            </div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground sm:col-span-2">
              <Save className="h-3 w-3" /> تغییر هر کلید بلافاصله ذخیره و در حسابرسی ثبت می‌شود.
            </p>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ------------------------------------------------------ traces */}
      <TabsContent value="traces" className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ListOrdered className="h-4 w-4" /> ردگیری‌های اخیر موتور</CardTitle>
            <CardDescription>
              تعارض شناسایی‌شده: {faNum(overview.traces.conflictDetected)} · توقف با بودجه: {faNum(overview.traces.budgetExceeded)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {overview.traces.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">هنوز ترنزاکشی ثبت نشده است.</p>
            ) : (
              overview.traces.recent.map((trace) => (
                <div key={trace.id} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={trace.decision === "ANSWERED" ? "default" : "secondary"}>
                      {DECISION_LABELS[trace.decision] ?? trace.decision}
                    </Badge>
                    <span className="font-medium">{trace.strategy}</span>
                    <span className="text-muted-foreground">{faNum(trace.iterations)} دور · {faNum(trace.llmCalls)} فراخوان · {faNum(trace.durationMs)}ms</span>
                    {trace.conflictDetected && <Badge variant="destructive">تعارض</Badge>}
                    {trace.supersededExcluded && <Badge variant="outline">سند منقضی حذف شد</Badge>}
                    {trace.budgetExceeded && <Badge variant="outline">پایان بودجه</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-muted-foreground">{trace.query}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{faDateTimeFormat(trace.createdAt)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ------------------------------------------------------ eval */}
      <TabsContent value="eval" className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> اجراهای ارزیابی</CardTitle>
            <CardDescription>
              اجرای تکرارپذیر داده مجموعه پذیرش: <code className="text-xs">bun run rag:eval</code> — هر اجرا در پایگاه داده ثبت می‌شود.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.evalRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">هنوز اجرایی ثبت نشده است.</p>
            ) : (
              overview.evalRuns.map((run) => (
                <div key={run.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <div>
                    <span className="font-medium">{run.datasetId}</span>
                    <span className="mr-2 text-xs text-muted-foreground">نسخه {run.engineVersion}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={run.failed === 0 ? "default" : "destructive"}>
                      {faNum(run.passed)}/{faNum(run.total)} موفق
                    </Badge>
                    <span className="text-xs text-muted-foreground">{faDateTimeFormat(run.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
