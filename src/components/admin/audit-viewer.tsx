"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/client/api";
import { faNum, faDateTimeFormat } from "@/lib/format";

type AuditRow = {
  id: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  actorLabel: string | null;
  actorName: string | null;
  actorUsername: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

type AuditPayload = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

const ACTOR_TYPE_LABELS: Record<string, { label: string; className: string }> = {
  USER: { label: "کاربر", className: "text-emerald-700 border-emerald-300 bg-emerald-50" },
  SYSTEM: { label: "سامانه", className: "text-amber-700 border-amber-300 bg-amber-50" },
  CUSTOMER: { label: "مراجع", className: "text-violet-700 border-violet-300 bg-violet-50" },
};

const COMMON_ACTION_PREFIXES = [
  "auth.",
  "user.",
  "role.",
  "department.",
  "ticket.",
  "file.",
  "folder.",
  "kb.",
  "ai.",
  "storage.",
  "conversation.",
  "identity.",
  "settings.",
  "system.",
];

function toIsoStart(dateValue: string): string | null {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toIsoEnd(dateValue: string): string | null {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function prettyMetadata(metadata: string | null): string {
  if (!metadata) return "—";
  try {
    return JSON.stringify(JSON.parse(metadata), null, 2);
  } catch {
    return metadata;
  }
}

export function AuditViewer() {
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState<string>("all");
  const [actorLabel, setActorLabel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [data, setData] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (action.trim()) params.set("action", action.trim());
    if (actorType !== "all") params.set("actorType", actorType);
    if (actorLabel.trim()) params.set("actorLabel", actorLabel.trim());
    const fromIso = toIsoStart(from);
    const toIso = toIsoEnd(to);
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return params.toString();
  }, [action, actorType, actorLabel, from, to, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiFetch<AuditPayload>(`/api/admin/audit?${query}`);
    setLoading(false);
    if (result.ok) {
      setData(result.data);
    } else {
      setError(result.error);
      setData(null);
    }
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Yield to a microtask so the effect does not setState synchronously.
      await Promise.resolve();
      if (!cancelled) void load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadToken]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function updateFilter(updater: () => void) {
    updater();
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 text-primary" aria-hidden="true" />
            فیلتر رخدادها
          </CardTitle>
          <CardDescription className="text-xs">
            همه رخدادهای حسابرسی ثبت‌شده سامانه — فیلترها هم‌زمان اعمال می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="audit-action">نوع رخداد</Label>
            <Input
              id="audit-action"
              dir="ltr"
              placeholder="مثلاً ticket. یا auth.login"
              value={action}
              onChange={(e) => updateFilter(() => setAction(e.target.value))}
              list="audit-action-prefixes"
            />
            <datalist id="audit-action-prefixes">
              {COMMON_ACTION_PREFIXES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-actor-type">نوع عامل</Label>
            <Select
              value={actorType}
              onValueChange={(v) => updateFilter(() => setActorType(v))}
            >
              <SelectTrigger id="audit-actor-type" aria-label="نوع عامل">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه</SelectItem>
                <SelectItem value="USER">کاربر</SelectItem>
                <SelectItem value="SYSTEM">سامانه</SelectItem>
                <SelectItem value="CUSTOMER">مراجع</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-actor-label">عامل (نام کاربری)</Label>
            <Input
              id="audit-actor-label"
              dir="ltr"
              placeholder="admin"
              value={actorLabel}
              onChange={(e) => updateFilter(() => setActorLabel(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-from">از تاریخ (میلادی)</Label>
            <Input
              id="audit-from"
              type="date"
              dir="ltr"
              value={from}
              onChange={(e) => updateFilter(() => setFrom(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to">تا تاریخ (میلادی)</Label>
            <Input
              id="audit-to"
              type="date"
              dir="ltr"
              value={to}
              onChange={(e) => updateFilter(() => setTo(e.target.value))}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPage(1);
                setReloadToken((t) => t + 1);
              }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              به‌روزرسانی
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                updateFilter(() => {
                  setAction("");
                  setActorType("all");
                  setActorLabel("");
                  setFrom("");
                  setTo("");
                });
              }}
              disabled={loading}
            >
              پاک‌سازی فیلترها
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Results */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-primary" aria-hidden="true" />
            رخدادها
          </CardTitle>
          <CardDescription className="text-xs">
            {data
              ? `${faNum(data.total)} رخداد — صفحه ${faNum(data.page)} از ${faNum(totalPages)}`
              : "در حال بارگذاری…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data && data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              رخدادی با این فیلترها یافت نشد.
            </p>
          ) : data ? (
            <div className="rounded-xl border overflow-hidden">
              <div className="overflow-x-auto max-h-[560px] overflow-y-auto scroll-slim">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">زمان</TableHead>
                      <TableHead className="text-right">عملیات</TableHead>
                      <TableHead className="text-right">عامل</TableHead>
                      <TableHead className="text-right">موجودیت</TableHead>
                      <TableHead className="text-right">IP</TableHead>
                      <TableHead className="text-right">جزئیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => {
                      const actorBadge = ACTOR_TYPE_LABELS[row.actorType] ?? {
                        label: row.actorType,
                        className: "",
                      };
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {faDateTimeFormat(row.createdAt)}
                          </TableCell>
                          <TableCell>
                            <code
                              dir="ltr"
                              className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium"
                            >
                              {row.action}
                            </code>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-col gap-1">
                              <span>
                                {row.actorName ?? row.actorLabel ?? "—"}
                                {row.actorUsername ? (
                                  <span dir="ltr" className="text-muted-foreground">
                                    {" "}
                                    @{row.actorUsername}
                                  </span>
                                ) : null}
                              </span>
                              <Badge variant="outline" className={`w-fit text-[10px] px-1.5 py-0 ${actorBadge.className}`}>
                                {actorBadge.label}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.entityType ? (
                              <span dir="ltr" className="text-muted-foreground">
                                {row.entityType}
                                {row.entityId ? ` · ${row.entityId}` : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell dir="ltr" className="text-xs text-muted-foreground whitespace-nowrap">
                            {row.ip ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setDetail(row)}
                              aria-label={`جزئیات رخداد ${row.action}`}
                            >
                              مشاهده
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {/* Pagination */}
          {data && data.rows.length > 0 ? (
            <div className="mt-4 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={loading || data.page <= 1}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                قبلی
              </Button>
              <span className="text-xs text-muted-foreground">
                صفحه {faNum(data.page)} از {faNum(totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading || data.page >= totalPages}
              >
                بعدی
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              رخداد <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">{detail?.action}</code>
            </DialogTitle>
            <DialogDescription>
              {detail ? faDateTimeFormat(detail.createdAt) : ""}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border p-2.5 space-y-1">
                  <p className="text-muted-foreground">عامل</p>
                  <p>
                    {detail.actorName ?? detail.actorLabel ?? "—"}
                    {detail.actorUsername ? (
                      <span dir="ltr" className="text-muted-foreground">
                        {" "}
                        @{detail.actorUsername}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="rounded-lg border p-2.5 space-y-1">
                  <p className="text-muted-foreground">نوع عامل</p>
                  <p>{ACTOR_TYPE_LABELS[detail.actorType]?.label ?? detail.actorType}</p>
                </div>
                <div className="rounded-lg border p-2.5 space-y-1">
                  <p className="text-muted-foreground">موجودیت</p>
                  <p dir="ltr" className="text-left">
                    {detail.entityType ?? "—"}
                    {detail.entityId ? ` · ${detail.entityId}` : ""}
                  </p>
                </div>
                <div className="rounded-lg border p-2.5 space-y-1">
                  <p className="text-muted-foreground">IP و مرورگر</p>
                  <p dir="ltr" className="text-left break-all">
                    {detail.ip ?? "—"}
                    {detail.userAgent ? ` — ${detail.userAgent}` : ""}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">فراداده (JSON)</p>
                <pre
                  dir="ltr"
                  className="max-h-56 overflow-auto scroll-slim rounded-lg border bg-muted/50 p-3 text-[11px] leading-5 text-left"
                >
                  {prettyMetadata(detail.metadata)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
