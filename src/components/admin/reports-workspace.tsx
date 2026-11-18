"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { apiFetch } from "@/lib/client/api";
import { faNum, faDateTimeFormat } from "@/lib/format";
import {
  TICKET_STATUS_LABELS,
  CREATED_VIA_LABELS,
} from "@/lib/tickets/types";

// ----------------------------------------------------------------- types --

type TicketReport = {
  days: number;
  totals: {
    created: number;
    resolvedInWindow: number;
    resolutionRatePct: number;
    avgFirstResponseMs: number | null;
    medianFirstResponseMs: number | null;
    avgResolutionMs: number | null;
    medianResolutionMs: number | null;
  };
  backlog: Array<{ status: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byCreatedVia: Array<{ via: string; count: number }>;
  byDepartment: Array<{ departmentId: string; departmentName: string; count: number }>;
  createdPerDay: Array<{ day: string; count: number }>;
  resolvedPerDay: Array<{ day: string; count: number }>;
};

type OperatorReport = {
  days: number;
  operators: Array<{
    id: string;
    name: string;
    username: string;
    roleName: string;
    status: string;
    isAvailable: boolean;
    assignedInWindow: number;
    resolvedInWindow: number;
    repliesInWindow: number;
    notesInWindow: number;
    openNow: number;
    lastReplyAt: string | null;
  }>;
};

type AssignmentReport = {
  days: number;
  totals: {
    created: number;
    assigned: number;
    unassigned: number;
    avgAssignDelayMs: number | null;
    medianAssignDelayMs: number | null;
  };
  byMode: Array<{ mode: string; count: number }>;
  byOperator: Array<{
    id: string;
    name: string;
    username: string;
    assignedInWindow: number;
    autoFair: number;
    manual: number;
    transfer: number;
    self: number;
    openNow: number;
  }>;
};

type AiUsage = {
  days: number;
  totals: {
    requests: number;
    answered: number;
    abstained: number;
    handoff: number;
    errors: number;
    avgLatencyMs: number;
    promptTokens: number;
    completionTokens: number;
  };
  byDay: Array<{ day: string; requests: number; promptTokens: number; completionTokens: number }>;
  byDepartment: Array<{ departmentId: string; departmentName: string | null; requests: number }>;
  recent: Array<{
    id: string;
    departmentName: string | null;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    outcome: string;
    createdAt: string;
  }>;
};

const DAY_OPTIONS = [1, 7, 14, 30, 90];

const MODE_LABELS: Record<string, string> = {
  AUTO_FAIR: "توزیع عادلانه خودکار",
  MANUAL: "ارجاع دستی",
  TRANSFER: "انتقال بین دپارتمان",
  SELF: "برداشت خود اپراتور",
};

const AI_OUTCOME_LABELS: Record<string, string> = {
  ANSWERED: "پاسخ مستند",
  ABSTAINED: "پرهیز از پاسخ",
  HANDOFF: "ارجاع به اپراتور",
  ERROR: "خطا",
};

// Warm, theme-agnostic palette (no blues).
const COLORS = {
  emerald: "#10b981",
  amber: "#f59e0b",
  orange: "#f97316",
  teal: "#14b8a6",
  purple: "#a855f7",
  rose: "#f43f5e",
  slate: "#94a3b8",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: COLORS.amber,
  IN_PROGRESS: COLORS.teal,
  WAITING_CUSTOMER: COLORS.orange,
  RESOLVED: COLORS.emerald,
  CLOSED: COLORS.slate,
};

const VIA_COLORS: Record<string, string> = {
  PORTAL: COLORS.emerald,
  OPERATOR_INTERNAL: COLORS.amber,
  CHAT_HANDOFF: COLORS.purple,
};

const MODE_COLORS: Record<string, string> = {
  AUTO_FAIR: COLORS.emerald,
  MANUAL: COLORS.amber,
  TRANSFER: COLORS.orange,
  SELF: COLORS.purple,
};

const OUTCOME_COLORS: Record<string, string> = {
  ANSWERED: COLORS.emerald,
  ABSTAINED: COLORS.amber,
  HANDOFF: COLORS.purple,
  ERROR: COLORS.rose,
};

/** Jalali short label for an ISO day key (rendered in UTC for stability). */
function faDayShort(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("fa-IR", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Persian duration for millisecond values. */
function faDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${faNum(seconds)} ثانیه`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${faNum(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes > 0 ? `${faNum(hours)} ساعت و ${faNum(restMinutes)} دقیقه` : `${faNum(hours)} ساعت`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${faNum(days)} روز و ${faNum(restHours)} ساعت` : `${faNum(days)} روز`;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------- workspace --

export function ReportsWorkspace({
  canViewTickets,
  canViewAi,
  canExportCsv,
  departments,
}: {
  canViewTickets: boolean;
  canViewAi: boolean;
  canExportCsv: boolean;
  departments: Array<{ id: string; name: string }>;
}) {
  const availableTabs = useMemo(() => {
    const tabs: string[] = [];
    if (canViewTickets) tabs.push("tickets", "operators", "assignments");
    if (canViewAi) tabs.push("ai");
    return tabs;
  }, [canViewTickets, canViewAi]);

  const [activeTab, setActiveTab] = useState(availableTabs[0] ?? "tickets");
  const [days, setDays] = useState(7);
  const [departmentId, setDepartmentId] = useState<string>("all");
  const [reloadToken, setReloadToken] = useState(0);

  const deptParam = departmentId === "all" ? null : departmentId;

  return (
    <div className="space-y-4">
      {/* Global window controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">بازه گزارش:</span>
        <Select
          value={String(days)}
          onValueChange={(v) => {
            setDays(Number(v));
            setReloadToken((t) => t + 1);
          }}
        >
          <SelectTrigger className="w-40" aria-label="بازه گزارش">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d === 1 ? "۲۴ ساعت گذشته" : `${faNum(d)} روز گذشته`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReloadToken((t) => t + 1)}
          aria-label="به‌روزرسانی گزارش‌ها"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          به‌روزرسانی
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList className="flex-wrap h-auto">
          {canViewTickets ? <TabsTrigger value="tickets">تیکت‌ها</TabsTrigger> : null}
          {canViewTickets ? <TabsTrigger value="operators">فعالیت اپراتورها</TabsTrigger> : null}
          {canViewTickets ? <TabsTrigger value="assignments">تخصیص و ارجاع</TabsTrigger> : null}
          {canViewAi ? <TabsTrigger value="ai">مصرف هوش مصنوعی</TabsTrigger> : null}
        </TabsList>

        {canViewTickets ? (
          <>
            <TabsContent value="tickets" className="mt-4 space-y-4">
              <TicketsTab days={days} departmentId={deptParam} departments={departments} reloadToken={reloadToken} canExportCsv={canExportCsv} />
            </TabsContent>
            <TabsContent value="operators" className="mt-4 space-y-4">
              <OperatorsTab days={days} reloadToken={reloadToken} />
            </TabsContent>
            <TabsContent value="assignments" className="mt-4 space-y-4">
              <AssignmentsTab days={days} departmentId={deptParam} departments={departments} reloadToken={reloadToken} />
            </TabsContent>
          </>
        ) : null}

        {canViewAi ? (
          <TabsContent value="ai" className="mt-4 space-y-4">
            <AiTab days={days} reloadToken={reloadToken} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------ tickets tab --

function TicketsTab({
  days,
  departmentId,
  departments,
  reloadToken,
  canExportCsv,
}: {
  days: number;
  departmentId: string | null;
  departments: Array<{ id: string; name: string }>;
  reloadToken: number;
  canExportCsv: boolean;
}) {
  const [report, setReport] = useState<TicketReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days) });
    if (departmentId) params.set("departmentId", departmentId);
    const result = await apiFetch<TicketReport>(`/api/admin/reports/tickets?${params.toString()}`);
    setLoading(false);
    if (result.ok) setReport(result.data);
    else {
      setError(result.error);
      setReport(null);
    }
  }, [days, departmentId]);

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

  if (loading && !report) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!report) return null;

  const dailyData = report.createdPerDay.map((d, i) => ({
    day: d.day,
    created: d.count,
    resolved: report.resolvedPerDay[i]?.count ?? 0,
  }));

  const trendConfig = {
    created: { label: "ایجادشده", color: COLORS.amber },
    resolved: { label: "حل‌شده", color: COLORS.emerald },
  } satisfies ChartConfig;

  const statusData = report.byStatus.map((s) => ({
    key: s.status,
    value: s.count,
    label: TICKET_STATUS_LABELS[s.status as keyof typeof TICKET_STATUS_LABELS] ?? s.status,
  }));
  const statusConfig: ChartConfig = Object.fromEntries(
    statusData.map((s) => [s.key, { label: s.label, color: STATUS_COLORS[s.key] ?? COLORS.slate }])
  );

  const viaData = report.byCreatedVia.map((v) => ({
    key: v.via,
    value: v.count,
    label: CREATED_VIA_LABELS[v.via as keyof typeof CREATED_VIA_LABELS] ?? v.via,
  }));
  const viaConfig: ChartConfig = Object.fromEntries(
    viaData.map((v) => [v.key, { label: v.label, color: VIA_COLORS[v.key] ?? COLORS.slate }])
  );

  const deptData = report.byDepartment.map((d) => ({
    name: d.departmentName,
    value: d.count,
  }));
  const deptConfig = {
    value: { label: "تیکت", color: COLORS.teal },
  } satisfies ChartConfig;

  const exportParams = new URLSearchParams({ days: String(days) });
  if (departmentId) exportParams.set("departmentId", departmentId);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="تیکت‌های ایجادشده" value={faNum(report.totals.created)} hint={`در بازه ${faNum(report.days)} روز`} />
        <StatCard
          label="نرخ حل‌شدن"
          value={`${faNum(report.totals.resolutionRatePct)}٪`}
          hint={`${faNum(report.totals.resolvedInWindow)} تیکت در همین بازه حل شد`}
        />
        <StatCard
          label="اولین پاسخ (میانگین)"
          value={faDuration(report.totals.avgFirstResponseMs)}
          hint={`میانه: ${faDuration(report.totals.medianFirstResponseMs)}`}
        />
        <StatCard
          label="زمان حل (میانگین)"
          value={faDuration(report.totals.avgResolutionMs)}
          hint={`میانه: ${faDuration(report.totals.medianResolutionMs)}`}
        />
      </div>

      {/* Daily trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">روند روزانه ایجاد و حل تیکت</CardTitle>
          <CardDescription className="text-xs">
            سری صفرپرشده بر پایه تقویم تهران — شامل روزهای بدون رخداد.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={trendConfig} className="h-64 w-full" dir="ltr">
            <LineChart data={dailyData} margin={{ left: -16, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickFormatter={faDayShort} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="created" stroke="var(--color-created)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="resolved" stroke="var(--color-resolved)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Current status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">وضعیت تیکت‌های ایجادشده</CardTitle>
            <CardDescription className="text-xs">وضعیت فعلی تیکت‌های این بازه</CardDescription>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">تیکتی در این بازه ثبت نشده است.</p>
            ) : (
              <ChartContainer config={statusConfig} className="h-52 w-full" dir="ltr">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={statusData} dataKey="value" nameKey="key" innerRadius={40} outerRadius={72} paddingAngle={2}>
                    {statusData.map((s) => (
                      <Cell key={s.key} fill={`var(--color-${s.key})`} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
            <ul className="mt-2 space-y-1">
              {statusData.map((s) => (
                <li key={s.key} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[s.key] ?? COLORS.slate }} aria-hidden="true" />
                    {s.label}
                  </span>
                  <span>{faNum(s.value)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Created via */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">نحوه ایجاد</CardTitle>
            <CardDescription className="text-xs">پورتال مراجعان، ثبت داخلی یا ارجاع از گفتگو</CardDescription>
          </CardHeader>
          <CardContent>
            {viaData.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">داده‌ای موجود نیست.</p>
            ) : (
              <ChartContainer config={viaConfig} className="h-52 w-full" dir="ltr">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={viaData} dataKey="value" nameKey="key" innerRadius={40} outerRadius={72} paddingAngle={2}>
                    {viaData.map((v) => (
                      <Cell key={v.key} fill={`var(--color-${v.key})`} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
            <ul className="mt-2 space-y-1">
              {viaData.map((v) => (
                <li key={v.key} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: VIA_COLORS[v.key] ?? COLORS.slate }} aria-hidden="true" />
                    {v.label}
                  </span>
                  <span>{faNum(v.value)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Backlog + per department */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">موجودی باز (فعلی)</CardTitle>
            <CardDescription className="text-xs">
              وضعیت باز در کل عمر تیکت‌ها{report.byDepartment.length > 1 ? " — کل سامانه" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5">
              {report.backlog.length === 0 ? (
                <li className="text-xs text-muted-foreground">هیچ تیکت بازی وجود ندارد — همه حل‌شده است.</li>
              ) : (
                report.backlog.map((b) => (
                  <li key={b.status} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[b.status] ?? COLORS.slate }} aria-hidden="true" />
                      {TICKET_STATUS_LABELS[b.status as keyof typeof TICKET_STATUS_LABELS] ?? b.status}
                    </span>
                    <span className="font-medium">{faNum(b.count)}</span>
                  </li>
                ))
              )}
            </ul>
            {deptData.length > 1 ? (
              <>
                <p className="text-xs font-medium pt-1">ایجادشده به تفکیک دپارتمان</p>
                <ChartContainer config={deptConfig} className="h-40 w-full" dir="ltr">
                  <BarChart data={deptData} margin={{ left: -24 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Bar dataKey="value" fill="var(--color-value)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* CSV export */}
      {canExportCsv ? (
        <div className="flex items-center gap-3">
          <a
            href={`/api/admin/reports/tickets/export.csv?${exportParams.toString()}`}
            download
            className="inline-flex"
          >
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" aria-hidden="true" />
              خروجی CSV تیکت‌های این بازه
            </Button>
          </a>
          <span className="text-xs text-muted-foreground">
            خروجی با مجوز «tickets.export» گرفته می‌شود و در حسابرسی ثبت می‌گردد.
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------- operators tab --

function OperatorsTab({
  days,
  reloadToken,
}: {
  days: number;
  reloadToken: number;
}) {
  const [report, setReport] = useState<OperatorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiFetch<OperatorReport>(`/api/admin/reports/operators?days=${days}`);
    setLoading(false);
    if (result.ok) setReport(result.data);
    else {
      setError(result.error);
      setReport(null);
    }
  }, [days]);

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

  if (loading && !report) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!report) return null;

  const chartData = report.operators
    .filter((o) => o.assignedInWindow > 0 || o.resolvedInWindow > 0)
    .slice(0, 10)
    .map((o) => ({ name: o.name, assigned: o.assignedInWindow, resolved: o.resolvedInWindow }));

  const chartConfig = {
    assigned: { label: "ارجاع‌یافته", color: COLORS.amber },
    resolved: { label: "حل‌شده", color: COLORS.emerald },
  } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">کارنامه اپراتورها</CardTitle>
          <CardDescription className="text-xs">
            بار کاری در بازه {faNum(report.days)} روز + بار باز فعلی — مرتب‌شده بر اساس فعالیت.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ChartContainer config={chartConfig} className="h-56 w-full" dir="ltr">
              <BarChart data={chartData} margin={{ left: -16, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="assigned" fill="var(--color-assigned)" radius={4} />
                <Bar dataKey="resolved" fill="var(--color-resolved)" radius={4} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              در این بازه تیکتی به اپراتوری ارجاع نشده است.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">جزئیات فعالیت</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border overflow-hidden">
            <div className="overflow-x-auto max-h-[460px] overflow-y-auto scroll-slim">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">اپراتور</TableHead>
                    <TableHead className="text-right">نقش</TableHead>
                    <TableHead className="text-right">وضعیت</TableHead>
                    <TableHead className="text-right">ارجاع‌یافته</TableHead>
                    <TableHead className="text-right">حل‌شده</TableHead>
                    <TableHead className="text-right">پاسخ‌ها</TableHead>
                    <TableHead className="text-right">یادداشت داخلی</TableHead>
                    <TableHead className="text-right">بار باز فعلی</TableHead>
                    <TableHead className="text-right">آخرین پاسخ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.operators.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="text-sm">
                        {o.name}
                        <span dir="ltr" className="text-muted-foreground text-xs">
                          {" "}
                          @{o.username}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{o.roleName}</TableCell>
                      <TableCell>
                        <Badge variant={o.status === "ACTIVE" ? "outline" : "secondary"} className={o.status === "ACTIVE" ? "text-[10px] text-emerald-700 border-emerald-300" : "text-[10px]"}>
                          {o.status === "ACTIVE" ? (o.isAvailable ? "فعال و در دسترس" : "فعال") : o.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{faNum(o.assignedInWindow)}</TableCell>
                      <TableCell className="text-sm font-medium">{faNum(o.resolvedInWindow)}</TableCell>
                      <TableCell className="text-sm">{faNum(o.repliesInWindow)}</TableCell>
                      <TableCell className="text-sm">{faNum(o.notesInWindow)}</TableCell>
                      <TableCell className="text-sm">{faNum(o.openNow)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {o.lastReplyAt ? faDateTimeFormat(o.lastReplyAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// -------------------------------------------------------- assignments tab --

function AssignmentsTab({
  days,
  departmentId,
  departments,
  reloadToken,
}: {
  days: number;
  departmentId: string | null;
  departments: Array<{ id: string; name: string }>;
  reloadToken: number;
}) {
  const [report, setReport] = useState<AssignmentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days) });
    if (departmentId) params.set("departmentId", departmentId);
    const result = await apiFetch<AssignmentReport>(`/api/admin/reports/assignments?${params.toString()}`);
    setLoading(false);
    if (result.ok) setReport(result.data);
    else {
      setError(result.error);
      setReport(null);
    }
  }, [days, departmentId]);

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

  if (loading && !report) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!report) return null;

  const modeData = report.byMode.filter((m) => m.count > 0).map((m) => ({
    key: m.mode,
    value: m.count,
    label: MODE_LABELS[m.mode] ?? m.mode,
  }));
  const modeConfig: ChartConfig = Object.fromEntries(
    modeData.map((m) => [m.key, { label: m.label, color: MODE_COLORS[m.key] ?? COLORS.slate }])
  );

  const fairnessNote = (() => {
    const auto = report.byOperator.reduce((sum, o) => sum + o.autoFair, 0);
    const total = report.byOperator.reduce((sum, o) => sum + o.assignedInWindow, 0);
    if (total === 0) return null;
    const autoPct = Math.round((auto / total) * 100);
    return `سهم توزیع عادلانه خودکار: ${faNum(autoPct)}٪ از ${faNum(total)} ارجاع`;
  })();
  const autoSharePct =
    report.byOperator.reduce((s, o) => s + o.assignedInWindow, 0) > 0
      ? Math.round(
          (report.byOperator.reduce((s, o) => s + o.autoFair, 0) /
            Math.max(1, report.byOperator.reduce((s, o) => s + o.assignedInWindow, 0))) *
            100
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="تیکت‌های ایجادشده" value={faNum(report.totals.created)} hint={`در بازه ${faNum(report.days)} روز`} />
        <StatCard label="ارجاع‌یافته" value={faNum(report.totals.assigned)} hint={`${faNum(report.totals.unassigned)} بدون ارجاع`} />
        <StatCard
          label="فاصله تا ارجاع (میانگین)"
          value={faDuration(report.totals.avgAssignDelayMs)}
          hint={`میانه: ${faDuration(report.totals.medianAssignDelayMs)}`}
        />
        <StatCard
          label="سهم توزیع خودکار"
          value={autoSharePct !== null ? `${faNum(autoSharePct)}٪` : "—"}
          hint={fairnessNote ?? "هنوز ارجاعی ثبت نشده است"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">توزیع بر اساس نحوه ارجاع</CardTitle>
            <CardDescription className="text-xs">
              الگوریتم عادلانه کمترین بار فعال را در دپارتمان انتخاب می‌کند.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {modeData.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">ارجاعی در این بازه ثبت نشده است.</p>
            ) : (
              <>
                <ChartContainer config={modeConfig} className="h-52 w-full" dir="ltr">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie data={modeData} dataKey="value" nameKey="key" innerRadius={40} outerRadius={72} paddingAngle={2}>
                      {modeData.map((m) => (
                        <Cell key={m.key} fill={`var(--color-${m.key})`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <ul className="mt-2 space-y-1">
                  {modeData.map((m) => (
                    <li key={m.key} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: MODE_COLORS[m.key] ?? COLORS.slate }} aria-hidden="true" />
                        {m.label}
                      </span>
                      <span>{faNum(m.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ارجاع به تفکیک اپراتور</CardTitle>
            <CardDescription className="text-xs">
              تفکیک نحوه ارجاع هر اپراتور و بار باز فعلی.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.byOperator.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                هیچ اپراتوری در این بازه تیکت دریافت نکرده است.
              </p>
            ) : (
              <div className="rounded-xl border overflow-hidden">
                <div className="overflow-x-auto max-h-[320px] overflow-y-auto scroll-slim">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">اپراتور</TableHead>
                        <TableHead className="text-right">خودکار</TableHead>
                        <TableHead className="text-right">دستی</TableHead>
                        <TableHead className="text-right">انتقال</TableHead>
                        <TableHead className="text-right">برداشت</TableHead>
                        <TableHead className="text-right">جمع</TableHead>
                        <TableHead className="text-right">بار باز</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.byOperator.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="text-sm">
                            {o.name}
                            <span dir="ltr" className="text-muted-foreground text-xs">
                              {" "}
                              @{o.username}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{faNum(o.autoFair)}</TableCell>
                          <TableCell className="text-sm">{faNum(o.manual)}</TableCell>
                          <TableCell className="text-sm">{faNum(o.transfer)}</TableCell>
                          <TableCell className="text-sm">{faNum(o.self)}</TableCell>
                          <TableCell className="text-sm font-medium">{faNum(o.assignedInWindow)}</TableCell>
                          <TableCell className="text-sm">{faNum(o.openNow)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- AI tab ----

function AiTab({ days, reloadToken }: { days: number; reloadToken: number }) {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiFetch<AiUsage>(`/api/admin/ai/usage?days=${days}`);
    setLoading(false);
    if (result.ok) setUsage(result.data);
    else {
      setError(result.error);
      setUsage(null);
    }
  }, [days]);

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

  if (loading && !usage) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!usage) return null;

  const totals = usage.totals;

  const dailyData = usage.byDay.map((d) => ({
    day: d.day,
    requests: d.requests,
    tokens: d.promptTokens + d.completionTokens,
  }));
  const dailyConfig = {
    requests: { label: "درخواست", color: COLORS.purple },
    tokens: { label: "توکن", color: COLORS.amber },
  } satisfies ChartConfig;

  const outcomeData = [
    { key: "ANSWERED", value: totals.answered, label: AI_OUTCOME_LABELS.ANSWERED },
    { key: "ABSTAINED", value: totals.abstained, label: AI_OUTCOME_LABELS.ABSTAINED },
    { key: "HANDOFF", value: totals.handoff, label: AI_OUTCOME_LABELS.HANDOFF },
    { key: "ERROR", value: totals.errors, label: AI_OUTCOME_LABELS.ERROR },
  ].filter((o) => o.value > 0);
  const outcomeConfig: ChartConfig = Object.fromEntries(
    outcomeData.map((o) => [o.key, { label: o.label, color: OUTCOME_COLORS[o.key] ?? COLORS.slate }])
  );

  const deptData = usage.byDepartment.map((d) => ({
    name: d.departmentName ?? "—",
    value: d.requests,
  }));
  const deptConfig = {
    value: { label: "درخواست", color: COLORS.teal },
  } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="درخواست‌های AI" value={faNum(totals.requests)} hint={`در بازه ${faNum(usage.days)} روز`} />
        <StatCard label="میانگین تأخیر" value={faDuration(totals.avgLatencyMs)} />
        <StatCard
          label="توکن کل"
          value={faNum(totals.promptTokens + totals.completionTokens)}
          hint={`ورودی ${faNum(totals.promptTokens)} — خروجی ${faNum(totals.completionTokens)}`}
        />
        <StatCard
          label="نرخ ارجاع به اپراتور"
          value={totals.requests > 0 ? `${faNum(Math.round((totals.handoff / totals.requests) * 100))}٪` : "—"}
          hint={`${faNum(totals.handoff)} ارجاع از ${faNum(totals.requests)} درخواست`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">روند روزانه درخواست و توکن</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={dailyConfig} className="h-56 w-full" dir="ltr">
              <LineChart data={dailyData} margin={{ left: -16, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickFormatter={faDayShort} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="requests" stroke="var(--color-requests)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="tokens" stroke="var(--color-tokens)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">نتیجه مکالمات</CardTitle>
            <CardDescription className="text-xs">
              پرهیز از پاسخ یعنی دستیار منبع معتبری در مخزن دانش نیافته است.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {outcomeData.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                در این بازه درخواستی به دستیار هوشمند ارسال نشده است.
              </p>
            ) : (
              <>
                <ChartContainer config={outcomeConfig} className="h-52 w-full" dir="ltr">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie data={outcomeData} dataKey="value" nameKey="key" innerRadius={40} outerRadius={72} paddingAngle={2}>
                      {outcomeData.map((o) => (
                        <Cell key={o.key} fill={`var(--color-${o.key})`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <ul className="mt-2 space-y-1">
                  {outcomeData.map((o) => (
                    <li key={o.key} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: OUTCOME_COLORS[o.key] ?? COLORS.slate }} aria-hidden="true" />
                        {o.label}
                      </span>
                      <span>{faNum(o.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">آخرین فراخوانی‌ها</CardTitle>
          <CardDescription className="text-xs">۲۵ فراخوانی اخیر دستیار هوشمند</CardDescription>
        </CardHeader>
        <CardContent>
          {usage.recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">فراخوانی‌ای ثبت نشده است.</p>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto scroll-slim">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">زمان</TableHead>
                      <TableHead className="text-right">دپارتمان</TableHead>
                      <TableHead className="text-right">نتیجه</TableHead>
                      <TableHead className="text-right">مدل</TableHead>
                      <TableHead className="text-right">توکن ورودی</TableHead>
                      <TableHead className="text-right">توکن خروجی</TableHead>
                      <TableHead className="text-right">تأخیر</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.recent.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs whitespace-nowrap">{faDateTimeFormat(row.createdAt)}</TableCell>
                        <TableCell className="text-xs">{row.departmentName ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${row.outcome === "ANSWERED" ? "text-emerald-700 border-emerald-300" : row.outcome === "ERROR" ? "text-rose-700 border-rose-300" : "text-amber-700 border-amber-300"}`}
                          >
                            {AI_OUTCOME_LABELS[row.outcome] ?? row.outcome}
                          </Badge>
                        </TableCell>
                        <TableCell dir="ltr" className="text-xs text-muted-foreground text-left max-w-40 truncate">
                          {row.model}
                        </TableCell>
                        <TableCell className="text-sm">{faNum(row.promptTokens)}</TableCell>
                        <TableCell className="text-sm">{faNum(row.completionTokens)}</TableCell>
                        <TableCell className="text-sm">{faNum(row.latencyMs)} میلی‌ثانیه</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
