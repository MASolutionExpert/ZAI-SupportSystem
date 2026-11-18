"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Ban,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import { faDateTimeFormat, faNum } from "@/lib/format";

// ------------------------------------------------------------------- types --

type CitizenListItem = {
  id: string;
  fullName: string;
  maskedNationalId: string;
  status: "ACTIVE" | "BLOCKED";
  ticketCount: number;
  conversationCount: number;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type CitizenListPayload = {
  citizens: CitizenListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 20;

async function fetchCitizens(opts: {
  query: string;
  status: string;
  page: number;
}): Promise<{ ok: true; data: CitizenListPayload } | { ok: false; error: string }> {
  const params = new URLSearchParams();
  if (opts.query.trim()) params.set("q", opts.query.trim());
  if (opts.status !== "ALL") params.set("status", opts.status);
  params.set("page", String(opts.page));
  params.set("pageSize", String(PAGE_SIZE));
  return apiFetch<CitizenListPayload>(`/api/admin/citizens?${params.toString()}`);
}

function StatusBadge({ status }: { status: "ACTIVE" | "BLOCKED" }) {
  return status === "ACTIVE" ? (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
      فعال
    </Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
      مسدود
    </Badge>
  );
}

/** One-time password reveal after a superadmin reset. */
function GeneratedPasswordBox({ password }: { password: string }) {
  const { toast } = useToast();
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900" role="alert">
      <p className="text-xs font-bold">رمز جدید یک‌بار نمایش داده می‌شود — آن را برای مراجع ارسال کنید:</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <code dir="ltr" className="rounded bg-amber-100 px-2.5 py-1.5 text-base font-bold tracking-wide">
          {password}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-amber-300 text-amber-900 hover:bg-amber-100"
          onClick={() => {
            void navigator.clipboard
              .writeText(password)
              .then(() => toast({ title: "رمز در حافظه کپی شد" }))
              .catch(() => toast({ title: "کپی ناموفق بود", variant: "destructive" }));
          }}
        >
          کپی
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-amber-800/80">
        این رمز ذخیره نمی‌شود و دوباره نمایش داده نخواهد شد. مراجع می‌تواند پس از ورود در پورتال، آن را از قسمت «تغییر رمز» عوض کند.
      </p>
    </div>
  );
}

// -------------------------------------------------------- main component --

export function CitizensManager() {
  const { toast } = useToast();

  const [booting, setBooting] = useState(true);
  const [data, setData] = useState<CitizenListPayload | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | "ACTIVE" | "BLOCKED">("ALL");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  // edit dialog
  const [editTarget, setEditTarget] = useState<CitizenListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editPending, setEditPending] = useState(false);

  // reset-password dialog
  const [resetTarget, setResetTarget] = useState<CitizenListItem | null>(null);
  const [resetMode, setResetMode] = useState<"generate" | "manual">("generate");
  const [manualPassword, setManualPassword] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // delete target
  const [deleteTarget, setDeleteTarget] = useState<CitizenListItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setRefreshing(true);
      const res = await fetchCitizens({ query, status, page });
      if (!opts?.silent) setRefreshing(false);
      if (!res.ok) {
        toast({ title: "دریافت فهرست کاربران ناموفق بود", description: res.error, variant: "destructive" });
        return;
      }
      setData(res.data);
    },
    [query, status, page, toast]
  );

  // Debounced load — also the initial fetch (booting stays true until the
  // first response lands; no synchronous setState inside the effect body).
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const res = await fetchCitizens({ query, status, page });
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else
        toast({
          title: "دریافت فهرست کاربران ناموفق بود",
          description: res.error,
          variant: "destructive",
        });
      setBooting(false);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, status, page, toast]);

  function openEdit(c: CitizenListItem) {
    setEditTarget(c);
    setEditName(c.fullName);
  }

  async function submitEdit() {
    if (!editTarget || editPending) return;
    setEditPending(true);
    const res = await apiFetch<{ citizen: unknown }>(
      `/api/admin/citizens/${editTarget.id}`,
      apiJson("PATCH", { fullName: editName })
    );
    setEditPending(false);
    if (!res.ok) {
      toast({ title: "ویرایش ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "نام کاربر به‌روزرسانی شد" });
    setEditTarget(null);
    void load({ silent: true });
  }

  async function toggleStatus(c: CitizenListItem) {
    const next = c.status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
    const res = await apiFetch<{ citizen: unknown }>(
      `/api/admin/citizens/${c.id}`,
      apiJson("PATCH", { status: next })
    );
    if (!res.ok) {
      toast({ title: "تغییر وضعیت ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: next === "BLOCKED" ? "حساب مسدود شد" : "حساب فعال شد",
      description:
        next === "BLOCKED"
          ? "این مراجع دیگر نمی‌تواند تیکت ثبت کند یا وارد شود."
          : "این مراجع می‌تواند دوباره وارد شود و تیکت ثبت کند.",
    });
    void load({ silent: true });
  }

  async function submitReset() {
    if (!resetTarget || resetPending) return;
    if (resetMode === "manual" && manualPassword.length < 8) {
      toast({ title: "رمز دستی کوتاه است", description: "رمز باید حداقل ۸ کاراکتر باشد.", variant: "destructive" });
      return;
    }
    setResetPending(true);
    const res = await apiFetch<{ password: string }>(
      `/api/admin/citizens/${resetTarget.id}/reset-password`,
      apiJson("POST", resetMode === "manual" ? { password: manualPassword } : {})
    );
    setResetPending(false);
    if (!res.ok) {
      toast({ title: "بازنشانی رمز ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setGeneratedPassword(res.data.password);
    setManualPassword("");
    void load({ silent: true });
  }

  async function submitDelete() {
    if (!deleteTarget || deletePending) return;
    setDeletePending(true);
    const res = await apiFetch<{ deleted: boolean }>(`/api/admin/citizens/${deleteTarget.id}`, {
      method: "DELETE",
    });
    setDeletePending(false);
    if (!res.ok) {
      toast({ title: "حذف حساب ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "حساب حذف شد",
      description: "تیکت‌ها و گفتگوهای این مراجع بدون اتصال به حساب، حفظ شده‌اند.",
    });
    setDeleteTarget(null);
    void load({ silent: true });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="h-4.5 w-4.5" aria-hidden="true" />
              فهرست کاربران
              {data ? (
                <Badge variant="secondary" className="tabular-nums">
                  {faNum(data.total)} نفر
                </Badge>
              ) : null}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 gap-1.5"
              onClick={() => void load()}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
              بازخوانی
            </Button>
          </div>
          <CardDescription className="text-xs">
            جستجو با بخشی از نام یا با کد ملی کامل (کد ملی فقط برای یافتن حساب استفاده می‌شود و هرگز نمایش داده نمی‌شود).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="نام یا کد ملی…"
                aria-label="جستجوی کاربران"
                className="min-h-11 pe-9"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              {(["ALL", "ACTIVE", "BLOCKED"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatus(s);
                    setPage(1);
                  }}
                  className={[
                    "rounded-md px-3 py-1.5 text-xs transition-colors",
                    status === s
                      ? "bg-background font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {s === "ALL" ? "همه" : s === "ACTIVE" ? "فعال" : "مسدود"}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {booting ? (
        <div className="space-y-2.5" aria-hidden="true">
          <Skeleton className="h-[84px] w-full rounded-xl" />
          <Skeleton className="h-[84px] w-full rounded-xl" />
          <Skeleton className="h-[84px] w-full rounded-xl" />
        </div>
      ) : !data || data.citizens.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {query || status !== "ALL"
            ? "کاربری با این مشخصات یافت نشد."
            : "هنوز کاربری ثبت نشده است؛ با نخستین تیکت یا گفتگو، حساب مراجع ساخته می‌شود."}
        </div>
      ) : (
        <div className="scroll-slim max-h-[560px] space-y-2.5 overflow-y-auto pe-1">
          {data.citizens.map((c) => (
            <Card key={c.id} className="py-0">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={[
                      "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      c.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-destructive/10 text-destructive",
                    ].join(" ")}
                  >
                    <UserRound className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <span className="truncate">{c.fullName}</span>
                      <StatusBadge status={c.status} />
                      {!c.hasPassword ? (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          بدون رمز (قدیمی)
                        </Badge>
                      ) : null}
                      {c.mustChangePassword ? (
                        <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">
                          رمز موقت
                        </Badge>
                      ) : null}
                    </p>
                    <p dir="ltr" className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {c.maskedNationalId}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {faNum(c.ticketCount)} تیکت
                      </span>
                      <span>{faNum(c.conversationCount)} گفتگو</span>
                      <span>ثبت‌نام: {faDateTimeFormat(c.createdAt)}</span>
                      <span>{c.lastLoginAt ? `آخرین ورود: ${faDateTimeFormat(c.lastLoginAt)}` : "بدون ورود"}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    ویرایش نام
                  </Button>
                  <Button variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => void toggleStatus(c)}>
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                    {c.status === "ACTIVE" ? "مسدودسازی" : "رفع مسدودی"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 gap-1.5"
                    onClick={() => {
                      setResetTarget(c);
                      setResetMode("generate");
                      setManualPassword("");
                      setGeneratedPassword(null);
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    بازنشانی رمز
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        حذف
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>حذف حساب «{deleteTarget?.fullName}»</AlertDialogTitle>
                        <AlertDialogDescription>
                          با حذف حساب، این مراجع دیگر نمی‌تواند با کد ملی خود وارد شود.
                          {deleteTarget && deleteTarget.ticketCount > 0
                            ? ` ${faNum(deleteTarget.ticketCount)} تیکت ثبت‌شده او حفظ می‌شود اما بدون اتصال به حساب خواهد ماند.`
                            : ""}{" "}
                          این اقدام قابل بازگشت نیست.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>انصراف</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={(e) => {
                            e.preventDefault();
                            void submitDelete();
                          }}
                        >
                          {deletePending ? "در حال حذف…" : "حذف قطعی حساب"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1"
            disabled={page <= 1 || refreshing}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            قبلی
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            صفحه {faNum(page)} از {faNum(totalPages)}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1"
            disabled={page >= totalPages || refreshing}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            بعدی
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {/* Edit name dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ویرایش نام کاربر</DialogTitle>
            <DialogDescription>
              نام نمایشی در میز پشتیبانی و پورتال را اصلاح کنید (کد ملی تغییر نمی‌کند).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="citizen-edit-name">نام و نام خانوادگی</Label>
            <Input
              id="citizen-edit-name"
              maxLength={80}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEditTarget(null)}>
              انصراف
            </Button>
            <Button onClick={() => void submitEdit()} disabled={editPending || editName.trim().length < 3}>
              {editPending ? "در حال ذخیره…" : "ذخیره"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={resetTarget !== null} onOpenChange={(v) => !v && setResetTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>بازنشانی رمز عبور — {resetTarget?.fullName}</DialogTitle>
            <DialogDescription>
              رمز موقت برای ورود مراجع فراموش‌کار صادر می‌شود؛ او می‌تواند بعداً در پورتال آن را عوض کند.
            </DialogDescription>
          </DialogHeader>

          {generatedPassword ? (
            <div className="space-y-3">
              <GeneratedPasswordBox password={generatedPassword} />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setResetTarget(null);
                    setGeneratedPassword(null);
                  }}
                >
                  پایان
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                {(["generate", "manual"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setResetMode(m)}
                    className={[
                      "flex-1 rounded-md px-3 py-1.5 text-xs transition-colors",
                      resetMode === m
                        ? "bg-background font-semibold shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {m === "generate" ? "تولید خودکار" : "تعیین دستی"}
                  </button>
                ))}
              </div>
              {resetMode === "manual" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="citizen-reset-password">رمز جدید (حداقل ۸ کاراکتر، حروف و عدد)</Label>
                  <Input
                    id="citizen-reset-password"
                    type="text"
                    dir="ltr"
                    className="text-left"
                    maxLength={128}
                    value={manualPassword}
                    onChange={(e) => setManualPassword(e.target.value)}
                    placeholder="مثلاً Rah1234m"
                  />
                </div>
              ) : (
                <p className="flex items-center gap-1.5 rounded-lg border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  رمز خوانا و امن به‌صورت خودکار ساخته می‌شود و فقط یک‌بار نمایش داده خواهد شد.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setResetTarget(null)}>
                  انصراف
                </Button>
                <Button onClick={() => void submitReset()} disabled={resetPending}>
                  {resetPending ? "در حال صدور…" : "صدور رمز جدید"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
