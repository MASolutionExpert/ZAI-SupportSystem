"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MessagesSquare, RefreshCw, Search, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/client/api";
import { faDateTimeFormat, faNum } from "@/lib/format";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------- types --

type CitizenThreadSummary = {
  id: string;
  fullName: string;
  maskedNationalId: string;
  ticketCount: number;
  lastActivityAt: string;
  lastExcerpt: string | null;
};

type ThreadMessage = {
  id: string;
  kind: "TICKET" | "CHAT";
  ref: string;
  authorType: "CUSTOMER" | "OPERATOR" | "SYSTEM" | "ASSISTANT";
  authorLabel: string | null;
  content: string;
  createdAt: string;
};

type CitizenThreadDetail = {
  citizen: { id: string; fullName: string; maskedNationalId: string; createdAt: string };
  tickets: Array<{
    id: string;
    number: number;
    subject: string;
    statusLabel: string;
    departmentName: string;
    updatedAt: string;
  }>;
  messages: ThreadMessage[];
};

const AUTO_REFRESH_MS = 30_000;

const AUTHOR_LABELS: Record<ThreadMessage["authorType"], string> = {
  CUSTOMER: "مراجع",
  OPERATOR: "اپراتور",
  SYSTEM: "سامانه",
  ASSISTANT: "دستیار هوشمند",
};

/** Persian relative time (compact form for the thread list). */
function faRelativeShort(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return "همین لحظه";
  if (minutes < 60) return `${faNum(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faNum(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${faNum(days)} روز پیش`;
  return faDateTimeFormat(d);
}

function MessageRow({ m }: { m: ThreadMessage }) {
  const isCustomer = m.authorType === "CUSTOMER";
  return (
    <div className={cn("flex flex-col gap-0.5", isCustomer ? "items-start" : "items-end")}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {m.kind === "TICKET" ? `تیکت ${m.ref}` : m.ref}
        </Badge>
        <span className="font-medium text-foreground/80">
          {m.authorLabel ?? AUTHOR_LABELS[m.authorType]}
        </span>
        <span>{faDateTimeFormat(m.createdAt)}</span>
      </div>
      <div
        className={cn(
          "max-w-[92%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-xs leading-5",
          isCustomer
            ? "rounded-ss-sm bg-primary/10 text-foreground"
            : "rounded-se-sm bg-muted text-foreground"
        )}
      >
        {m.content}
      </div>
    </div>
  );
}

// -------------------------------------------------------- main component --

export function CitizensThreads() {
  const { toast } = useToast();

  const [booting, setBooting] = useState(true);
  const [citizens, setCitizens] = useState<CitizenThreadSummary[]>([]);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CitizenThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (silent?: boolean) => {
      if (!silent) setRefreshing(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const res = await apiFetch<{ citizens: CitizenThreadSummary[] }>(
        `/api/staff/citizens?${params.toString()}`
      );
      if (!silent) setRefreshing(false);
      if (!res.ok) {
        toast({ title: "دریافت فهرست مراجعان ناموفق بود", description: res.error, variant: "destructive" });
        return;
      }
      setCitizens(res.data.citizens);
    },
    [query, toast]
  );

  // Debounced load — also the initial fetch (no synchronous setState inside
  // the effect body; booting clears once the first response lands).
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const res = await apiFetch<{ citizens: CitizenThreadSummary[] }>(
        `/api/staff/citizens?${params.toString()}`
      );
      if (cancelled) return;
      if (res.ok) setCitizens(res.data.citizens);
      else
        toast({
          title: "دریافت فهرست مراجعان ناموفق بود",
          description: res.error,
          variant: "destructive",
        });
      setBooting(false);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, toast]);

  // Poll the list every 30 s (silent, async — never sync setState).
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
     
  }, []);

  // Load the selected citizen's unified thread.
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;

    const loadDetail = async () => {
      setDetailLoading(true);
      const res = await apiFetch<{ thread: CitizenThreadDetail }>(`/api/staff/citizens/${openId}`);
      if (cancelled) return;
      setDetailLoading(false);
      if (!res.ok) {
        if (res.error !== "کاربر یافت نشد.") {
          toast({ title: "دریافت گفتگوی مراجع ناموفق بود", description: res.error, variant: "destructive" });
        }
        setDetail(null);
        return;
      }
      setDetail(res.data.thread);
    };
    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [openId, toast]);

  function toggleOpen(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessagesSquare className="h-4.5 w-4.5" aria-hidden="true" />
            گفتگوهای مراجعان (بر اساس کد ملی)
            {citizens.length > 0 ? (
              <Badge variant="secondary" className="tabular-nums">
                {faNum(citizens.length)} مراجع
              </Badge>
            ) : null}
          </CardTitle>
          <Button variant="ghost" size="sm" className="min-h-11 gap-1.5" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
            بازخوانی
          </Button>
        </div>
        <CardDescription className="text-xs">
          هر مراجع یک ردیف گفتگو دارد؛ آخرین پیام‌های او از تیکت‌ها و گفتگوهای زنده‌ی دپارتمان‌های شما
          (بدون یادداشت‌های داخلی) در همین‌جا دیده می‌شود. جستجو با نام یا کد ملی کامل.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی نام یا کد ملی…"
            aria-label="جستجوی مراجعان"
            className="min-h-11 pe-9"
          />
        </div>

        {booting ? (
          <div className="space-y-2.5" aria-hidden="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : citizens.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {query ? "مراجعی با این مشخصات در دامنه شما یافت نشد." : "هنوز گفتگویی از مراجعان در دامنه شما ثبت نشده است."}
          </p>
        ) : (
          <div className="scroll-slim max-h-96 space-y-2.5 overflow-y-auto pe-1">
            {citizens.map((c) => (
              <div key={c.id} className="rounded-xl border bg-card">
                <button
                  type="button"
                  onClick={() => toggleOpen(c.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3.5 text-start transition-colors hover:bg-muted/40"
                  aria-expanded={openId === c.id}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                      {c.fullName.trim().charAt(0)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <span className="truncate">{c.fullName}</span>
                        <span dir="ltr" className="text-[11px] tabular-nums text-muted-foreground">
                          {c.maskedNationalId}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {c.lastExcerpt ?? "—"}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Ticket className="h-3 w-3" aria-hidden="true" />
                      {faNum(c.ticketCount)} تیکت
                    </Badge>
                    <span>{faRelativeShort(c.lastActivityAt)}</span>
                    {openId === c.id ? (
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                </button>

                {openId === c.id ? (
                  <div className="border-t px-3.5 py-3">
                    {detailLoading ? (
                      <div className="space-y-2" aria-hidden="true">
                        <Skeleton className="h-10 w-full rounded-lg" />
                        <Skeleton className="h-10 w-2/3 rounded-lg" />
                      </div>
                    ) : detail ? (
                      <div className="space-y-3">
                        {detail.tickets.length > 0 ? (
                          <div className="scroll-slim flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                            {detail.tickets.map((t) => (
                              <Badge key={t.id} variant="secondary" className="max-w-full gap-1 text-[10px]">
                                <span dir="ltr" className="shrink-0 tabular-nums">#{faNum(t.number)}</span>
                                <span className="max-w-[180px] truncate">{t.subject}</span>
                                <span className="shrink-0 text-muted-foreground">({t.statusLabel})</span>
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">تیکتی در دامنه دپارتمان‌های شما ندارد.</p>
                        )}
                        <div
                          role="log"
                          aria-label={`پیام‌های ${detail.citizen.fullName}`}
                          className="scroll-slim flex max-h-72 flex-col gap-2.5 overflow-y-auto rounded-lg border bg-muted/20 p-3"
                        >
                          {detail.messages.length === 0 ? (
                            <p className="py-4 text-center text-xs text-muted-foreground">پیامی یافت نشد.</p>
                          ) : (
                            detail.messages.map((m) => <MessageRow key={m.id} m={m} />)
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="py-2 text-center text-xs text-muted-foreground">گفتگو در دسترس نیست.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
