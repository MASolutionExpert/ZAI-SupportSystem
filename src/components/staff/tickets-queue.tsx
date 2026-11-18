"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ClipboardList,
  FileText,
  Globe,
  History,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  SendHorizontal,
  Ticket as TicketIcon,
  UserRoundCog,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson, type ApiResult } from "@/lib/client/api";
import { faBytes, faDateTimeFormat, faNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_TRANSITIONS,
  type TicketStatus,
} from "@/lib/tickets/types";

// ------------------------------------------------------------ API payloads --

type TicketAttachmentView = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type TicketMessageView = {
  id: string;
  authorType: "CUSTOMER" | "OPERATOR" | "SYSTEM";
  authorLabel: string | null;
  content: string;
  isInternalNote: boolean;
  createdAt: string;
  attachments: TicketAttachmentView[];
};

type StaffTicketSummary = {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  statusLabel: string;
  departmentId: string;
  departmentName: string;
  customerId: string | null;
  customerName: string | null;
  customerMaskedNationalId: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdVia: string;
  conversationId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastExcerpt: string | null;
};

type StaffTicketDetail = StaffTicketSummary & {
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  messages: TicketMessageView[];
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    actorLabel: string | null;
    note: string | null;
    createdAt: string;
  }>;
};

type CustomerHistoryData = {
  customer: {
    id: string;
    fullName: string;
    maskedNationalId: string;
    status: string;
    createdAt: string;
  };
  tickets: Array<{
    id: string;
    number: number;
    subject: string;
    status: string;
    statusLabel: string;
    departmentName: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
};

type Assignee = { id: string; name: string; activeLoad: number };

type StatusFilter = "open" | "all" | TicketStatus;
type AssigneeFilter = "all" | "mine" | "unassigned";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "باز" },
  { value: "all", label: "همه" },
  ...TICKET_STATUSES.map((s) => ({ value: s as StatusFilter, label: TICKET_STATUS_LABELS[s] })),
];

const ASSIGNEE_FILTER_OPTIONS: { value: AssigneeFilter; label: string }[] = [
  { value: "all", label: "همه" },
  { value: "mine", label: "تیکت‌های من" },
  { value: "unassigned", label: "بدون مسئول" },
];

const AUTO_REFRESH_MS = 30000;
const MAX_FILES = 5;

// ---------------------------------------------------------------- helpers --

function faRelativeTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const past = diffMs >= 0;
  const minutes = Math.floor(Math.abs(diffMs) / 60000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${faNum(minutes)} دقیقه ${past ? "پیش" : "بعد"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faNum(hours)} ساعت ${past ? "پیش" : "بعد"}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${faNum(days)} روز ${past ? "پیش" : "بعد"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${faNum(months)} ماه ${past ? "پیش" : "بعد"}`;
  return faDateTimeFormat(d);
}

const STATUS_BADGE: Record<TicketStatus, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  OPEN: { variant: "secondary" },
  IN_PROGRESS: { variant: "default" },
  WAITING_CUSTOMER: { variant: "outline", className: "border-amber-300 bg-amber-50 text-amber-800" },
  RESOLVED: { variant: "outline", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  CLOSED: { variant: "outline", className: "text-muted-foreground" },
};

function StatusBadge({ status, label }: { status: TicketStatus; label: string }) {
  const style = STATUS_BADGE[status] ?? { variant: "outline" as const };
  return (
    <Badge variant={style.variant} className={cn("shrink-0 font-normal", style.className)}>
      {label}
    </Badge>
  );
}

const VIA_META: Record<string, { label: string; icon: React.ReactNode }> = {
  CHAT_HANDOFF: { label: "گفتگوی زنده", icon: <MessageSquare className="h-3 w-3" aria-hidden="true" /> },
  OPERATOR_INTERNAL: { label: "ثبت داخلی", icon: <ClipboardList className="h-3 w-3" aria-hidden="true" /> },
  PORTAL: { label: "پورتال", icon: <Globe className="h-3 w-3" aria-hidden="true" /> },
};

function CreatedViaChip({ via }: { via: string }) {
  const meta = VIA_META[via];
  if (!meta) return null;
  return (
    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
      {meta.icon}
      {meta.label}
    </Badge>
  );
}

/** Multipart POST helper (browser sets the multipart boundary itself). */
async function apiFormSubmit<T>(url: string, form: FormData): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: T; error?: string }
      | null;
    if (!res.ok || !body?.ok) {
      return { ok: false, error: body?.error ?? "خطای غیرمنتظره در ارتباط با سرور." };
    }
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, error: "ارتباط با سرور برقرار نشد." };
  }
}

// ------------------------------------------------------- message bubbles --

function TicketBubble({ message }: { message: TicketMessageView }) {
  if (message.authorType === "SYSTEM") {
    return (
      <p className="mx-auto max-w-full rounded-lg bg-muted/70 px-3 py-1.5 text-center text-xs leading-5 text-muted-foreground">
        {message.content}
        <span className="ms-2 text-[10px] text-muted-foreground/80">{faDateTimeFormat(message.createdAt)}</span>
      </p>
    );
  }

  const isCustomer = message.authorType === "CUSTOMER";
  const internal = message.isInternalNote;

  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col gap-1",
        isCustomer ? "items-start self-start" : "items-end self-end"
      )}
    >
      {internal ? (
        <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 font-normal text-amber-800">
          <Lock className="h-3 w-3" aria-hidden="true" />
          یادداشت داخلی
        </Badge>
      ) : null}
      <div
        className={cn(
          "whitespace-pre-wrap break-words px-3.5 py-2 text-sm leading-6",
          internal
            ? "rounded-2xl rounded-tl-sm border border-dashed border-amber-300 bg-amber-50 text-amber-900"
            : isCustomer
              ? "rounded-2xl rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-2xl rounded-tl-sm bg-muted text-foreground"
        )}
      >
        {message.content}
      </div>

      {message.attachments.length > 0 ? (
        <div className="flex flex-col gap-1">
          {message.attachments.map((a) => (
            <a
              key={a.id}
              href={`/api/staff/tickets/attachments/${a.id}`}
              download
              className="inline-flex max-w-56 items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-xs transition-colors hover:bg-muted"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 truncate">{a.filename}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{faBytes(a.sizeBytes)}</span>
            </a>
          ))}
        </div>
      ) : null}

      <span className="flex items-center gap-1.5 text-[10px] leading-4 text-muted-foreground/80">
        {message.authorLabel ? <span>{message.authorLabel}</span> : null}
        <span>{faDateTimeFormat(message.createdAt)}</span>
      </span>
    </div>
  );
}

// ------------------------------------------------- customer history dialog --

function CustomerHistoryDialog({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CustomerHistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await apiFetch<CustomerHistoryData>(`/api/staff/customers/${customerId}`);
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setData(res.data);
      else setError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customerId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
        <History className="h-4 w-4" aria-hidden="true" />
        سابقه مراجع
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>سابقه مراجع</DialogTitle>
          <DialogDescription className="text-xs">
            پروفایل و تیکت‌های پیشین این مراجع در دپارتمان‌های در دامنه شما.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : error ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{error}</p>
        ) : data ? (
          <div className="scroll-slim max-h-80 space-y-3 overflow-y-auto pe-1">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">{data.customer.fullName}</p>
              <p dir="ltr" className="mt-1 text-end font-mono text-xs text-muted-foreground">
                {data.customer.maskedNationalId}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {data.customer.status === "BLOCKED" ? (
                  <Badge variant="outline" className="border-destructive/40 bg-destructive/10 font-normal text-destructive">
                    حساب مسدود
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-emerald-300 bg-emerald-50 font-normal text-emerald-700">
                    حساب فعال
                  </Badge>
                )}
                <span>عضویت از {faDateTimeFormat(data.customer.createdAt)}</span>
              </div>
            </div>

            {data.tickets.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                تیکت دیگری برای این مراجع ثبت نشده است.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.tickets.map((t) => (
                  <li key={t.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span dir="ltr" className="shrink-0 font-mono text-xs font-bold text-muted-foreground">
                          #{faNum(t.number)}
                        </span>
                        <span className="truncate text-sm">{t.subject}</span>
                      </span>
                      <Badge
                        variant="outline"
                        className="shrink-0 font-normal text-muted-foreground"
                      >
                        {t.statusLabel}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.departmentName} — ثبت {faDateTimeFormat(t.createdAt)}
                      {t.resolvedAt ? ` — حل‌شده ${faDateTimeFormat(t.resolvedAt)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------- internal ticket dialog --

function InternalTicketDialog({
  departments,
  onCreated,
}: {
  departments: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [nationalId, setNationalId] = useState("");
  const [fullName, setFullName] = useState("");
  const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setNationalId("");
    setFullName("");
    setDepartmentId(undefined);
    setSubject("");
    setContent("");
    setFiles([]);
  }

  async function submit() {
    if (pending) return;
    if (nationalId.length !== 10) {
      toast({ title: "کد ملی باید ۱۰ رقم باشد", variant: "destructive" });
      return;
    }
    if (fullName.trim().length < 3) {
      toast({ title: "نام و نام خانوادگی مراجع را کامل وارد کنید", variant: "destructive" });
      return;
    }
    if (!departmentId) {
      toast({ title: "دپارتمان را انتخاب کنید", variant: "destructive" });
      return;
    }
    if (subject.trim().length < 2) {
      toast({ title: "موضوع تیکت را وارد کنید", variant: "destructive" });
      return;
    }
    if (content.trim().length < 1) {
      toast({ title: "توضیحات تیکت را وارد کنید", variant: "destructive" });
      return;
    }

    setPending(true);
    const form = new FormData();
    form.set("nationalId", nationalId);
    form.set("fullName", fullName.trim());
    form.set("departmentId", departmentId);
    form.set("subject", subject.trim());
    form.set("content", content.trim());
    for (const f of files) form.append("files", f);

    const res = await apiFormSubmit<{ ticketId: string; number: number }>(
      "/api/staff/tickets",
      form
    );
    setPending(false);

    if (!res.ok) {
      toast({ title: "ثبت تیکت ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }

    toast({ title: `تیکت #${faNum(res.data.number)} ثبت شد` });
    reset();
    setOpen(false);
    onCreated();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        ثبت تیکت داخلی
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ثبت تیکت داخلی</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            تیکت برای مراجعی که حضوری تماس گرفته است؛ پس از ثبت، طبق توزیع عادلانه به اپراتور ارجاع می‌شود.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-slim max-h-[60vh] space-y-3 overflow-y-auto pe-1">
          <div className="space-y-1.5">
            <Label htmlFor="internal-national-id">کد ملی مراجع</Label>
            <Input
              id="internal-national-id"
              dir="ltr"
              inputMode="numeric"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value.replace(/\D+/g, "").slice(0, 10))}
              placeholder="مثال: ۰۰۱۲۳۴۵۶۷۸"
              className="text-start font-mono"
              autoComplete="off"
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="internal-full-name">نام و نام خانوادگی مراجع</Label>
            <Input
              id="internal-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="نام کامل مراجع"
              maxLength={80}
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label>دپارتمان</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={pending}>
              <SelectTrigger className="w-full" aria-label="انتخاب دپارتمان">
                <SelectValue placeholder="انتخاب دپارتمان…" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="internal-subject">موضوع</Label>
            <Input
              id="internal-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="خلاصه درخواست مراجع"
              maxLength={150}
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="internal-content">توضیحات</Label>
            <Textarea
              id="internal-content"
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="شرح درخواست، اقدامات انجام‌شده و نکات لازم…"
              maxLength={4000}
              disabled={pending}
              className="min-h-11 resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
                e.target.value = "";
              }}
              aria-hidden="true"
              tabIndex={-1}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending || files.length >= MAX_FILES}
              >
                <Paperclip className="h-4 w-4" aria-hidden="true" />
                افزودن پیوست ({faNum(files.length)}/{faNum(MAX_FILES)})
              </Button>
            </div>
            {files.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="inline-flex max-w-52 items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`حذف پیوست ${f.name}`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            انصراف
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={pending}>
            {pending ? "در حال ثبت…" : "ثبت تیکت"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------- transfer dialog --

function TransferDialog({
  ticketId,
  currentDepartmentId,
  departments,
  onTransferred,
}: {
  ticketId: string;
  currentDepartmentId: string;
  departments: { id: string; name: string }[];
  onTransferred: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [targetId, setTargetId] = useState<string | undefined>(undefined);

  const targets = departments.filter((d) => d.id !== currentDepartmentId);

  async function submit() {
    if (!targetId || pending) return;
    setPending(true);
    const res = await apiFetch<{ departmentName: string }>(
      `/api/staff/tickets/${ticketId}/transfer`,
      apiJson("POST", { departmentId: targetId })
    );
    setPending(false);
    if (!res.ok) {
      toast({ title: "انتقال تیکت ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "تیکت منتقل شد", description: `دپارتمان مقصد: ${res.data.departmentName}` });
    setOpen(false);
    setTargetId(undefined);
    onTransferred();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTargetId(undefined);
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={targets.length === 0}
        title={targets.length === 0 ? "دپارتمان دیگری در دامنه شما نیست" : undefined}
      >
        انتقال به دپارتمان
      </Button>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>انتقال به دپارتمان دیگر</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            پس از انتقال، مسئول کنونی تیکت آزاد و طبق توزیع عادلانه در دپارتمان مقصد ارجاع می‌شود.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>دپارتمان مقصد</Label>
          <Select value={targetId} onValueChange={setTargetId} disabled={pending}>
            <SelectTrigger className="w-full" aria-label="انتخاب دپارتمان مقصد">
              <SelectValue placeholder="انتخاب دپارتمان…" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            انصراف
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={pending || !targetId}>
            {pending ? "در حال انتقال…" : "انتقال تیکت"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------- main component --

export function TicketsQueue({
  canReply,
  canNote,
  canStatus,
  canAssign,
  canTransfer,
  canInternal,
  canHistory,
  departments,
}: {
  canReply: boolean;
  canNote: boolean;
  canStatus: boolean;
  canAssign: boolean;
  canTransfer: boolean;
  canInternal: boolean;
  canHistory: boolean;
  departments: { id: string; name: string }[];
}) {
  const { toast } = useToast();

  // List + filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [items, setItems] = useState<StaffTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Detail sheet
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [actionPending, setActionPending] = useState(false);

  // Composer
  const [replyDraft, setReplyDraft] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [replyPending, setReplyPending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const detailScrollRef = useRef<HTMLDivElement | null>(null);

  // Debounce the search box (400 ms).
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => window.clearTimeout(t);
  }, [q]);

  const reloadList = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (deptFilter !== "all") params.set("departmentId", deptFilter);
      if (assigneeFilter !== "all") params.set("assigneeId", assigneeFilter);
      if (debouncedQ) params.set("q", debouncedQ);

      const res = await apiFetch<{ tickets: StaffTicketSummary[] }>(
        `/api/staff/tickets?${params.toString()}`
      );
      if (silent) setRefreshing(false);
      else setLoading(false);
      if (res.ok) {
        setItems(res.data.tickets);
      } else if (!silent) {
        toast({ title: "دریافت تیکت‌ها ناموفق بود", description: res.error, variant: "destructive" });
      }
    },
    [statusFilter, deptFilter, assigneeFilter, debouncedQ, toast]
  );

  // Initial load + reload on filter change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (deptFilter !== "all") params.set("departmentId", deptFilter);
      if (assigneeFilter !== "all") params.set("assigneeId", assigneeFilter);
      if (debouncedQ) params.set("q", debouncedQ);

      const res = await apiFetch<{ tickets: StaffTicketSummary[] }>(
        `/api/staff/tickets?${params.toString()}`
      );
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setItems(res.data.tickets);
      else toast({ title: "دریافت تیکت‌ها ناموفق بود", description: res.error, variant: "destructive" });
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, deptFilter, assigneeFilter, debouncedQ, toast]);

  // Poll the list every 30 s (silent).
  useEffect(() => {
    const id = window.setInterval(() => {
      void reloadList(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reloadList]);

  const refreshAll = useCallback(() => {
    void reloadList(true);
    setDetailReloadKey((k) => k + 1);
  }, [reloadList]);

  // --------------------------------------------------------------- detail --

  function openSheet(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setReplyDraft("");
    setInternalNote(false);
    setFiles([]);
    setAssignees([]);
  }

  function closeSheet() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setReplyDraft("");
    setInternalNote(false);
    setFiles([]);
    setAssignees([]);
  }

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ ticket: StaffTicketDetail }>(`/api/staff/tickets/${selectedId}`);
      if (cancelled) return;
      setDetailLoading(false);
      if (res.ok) {
        setDetail(res.data.ticket);
        setDetailError(null);
      } else {
        setDetailError(res.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailReloadKey]);

  // Eligible assignees for the selected ticket's department.
  useEffect(() => {
    if (!selectedId || !canAssign) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ assignees: Assignee[] }>(
        `/api/staff/tickets/${selectedId}/assignees`
      );
      if (cancelled || !res.ok) return;
      setAssignees(res.data.assignees);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, canAssign, detailReloadKey]);

  // Auto-scroll transcript to the newest message.
  useEffect(() => {
    const el = detailScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.messages.length, detailLoading]);

  // --------------------------------------------------------------- actions --

  async function changeStatus(toStatus: TicketStatus) {
    if (!detail || actionPending) return;
    setActionPending(true);
    const res = await apiFetch<{ status: TicketStatus }>(
      `/api/staff/tickets/${detail.id}/status`,
      apiJson("POST", { toStatus })
    );
    setActionPending(false);
    if (!res.ok) {
      toast({ title: "تغییر وضعیت ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `وضعیت تیکت به «${TICKET_STATUS_LABELS[res.data.status]}» تغییر کرد` });
    refreshAll();
  }

  async function assign(targetUserId?: string) {
    if (!detail || actionPending) return;
    setActionPending(true);
    const res = await apiFetch<{ assignedToName: string | null }>(
      `/api/staff/tickets/${detail.id}/assign`,
      apiJson("POST", targetUserId ? { targetUserId } : {})
    );
    setActionPending(false);
    if (!res.ok) {
      toast({ title: "ارجاع تیکت ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "تیکت ارجاع شد",
      description: res.data.assignedToName ? `مسئول: ${res.data.assignedToName}` : undefined,
    });
    refreshAll();
  }

  async function submitReply() {
    if (!detail || replyPending) return;
    const content = replyDraft.trim();
    if (content.length < 1) return;

    setReplyPending(true);
    const form = new FormData();
    form.set("content", content);
    form.set("isInternalNote", internalNote ? "true" : "false");
    for (const f of files) form.append("files", f);

    const res = await apiFormSubmit(`/api/staff/tickets/${detail.id}/messages`, form);
    setReplyPending(false);

    if (!res.ok) {
      toast({ title: "ارسال پیام ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }

    const wasNote = internalNote;
    setReplyDraft("");
    setInternalNote(false);
    setFiles([]);
    toast({ title: wasNote ? "یادداشت داخلی ثبت شد" : "پاسخ ثبت شد" });
    refreshAll();
  }

  // ---------------------------------------------------------------- render --

  const composerBlocked =
    detail !== null && (detail.status === "RESOLVED" || detail.status === "CLOSED");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TicketIcon className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            صف تیکت‌ها
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="به‌روزرسانی فهرست تیکت‌ها"
              onClick={() => void reloadList()}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
            </Button>
            {canInternal ? (
              <InternalTicketDialog
                departments={departments}
                onCreated={() => void reloadList(true)}
              />
            ) : null}
          </div>
        </div>
        <CardDescription className="text-xs">
          تیکت‌های دپارتمان‌های در دامنه شما؛ ارجاع عادلانه، یادداشت داخلی و انتقال بین دپارتمان‌ها از همین صفحه.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Filters */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو در موضوع، متن یا شماره تیکت…"
            aria-label="جستجو در تیکت‌ها"
            className="h-9 flex-1"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger size="sm" className="w-[150px]" aria-label="فیلتر وضعیت تیکت">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger size="sm" className="w-[180px]" aria-label="فیلتر دپارتمان">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه دپارتمان‌ها</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={assigneeFilter}
              onValueChange={(v) => setAssigneeFilter(v as AssigneeFilter)}
            >
              <SelectTrigger size="sm" className="w-[140px]" aria-label="فیلتر مسئول تیکت">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNEE_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            تیکتی با این فیلترها یافت نشد.
          </p>
        ) : (
          <ul className="scroll-slim flex max-h-[480px] flex-col gap-2 overflow-y-auto pe-1">
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openSheet(t.id)}
                  aria-haspopup="dialog"
                  className="w-full cursor-pointer rounded-lg border p-3 text-start transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        dir="ltr"
                        className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-bold text-secondary-foreground"
                      >
                        #{faNum(t.number)}
                      </span>
                      <span className="truncate text-sm font-medium">{t.subject}</span>
                    </span>
                    <StatusBadge status={t.status} label={t.statusLabel} />
                  </span>

                  <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t.customerName ?? "مراجع"}</span>
                    {t.customerMaskedNationalId ? (
                      <span dir="ltr" className="font-mono text-[11px]">
                        {t.customerMaskedNationalId}
                      </span>
                    ) : null}
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {t.departmentName}
                    </Badge>
                    <CreatedViaChip via={t.createdVia} />
                  </span>

                  <span className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground">
                      {t.assignedToName ? (
                        <Badge variant="secondary" className="gap-1 font-normal">
                          <UserRoundCog className="h-3 w-3" aria-hidden="true" />
                          {t.assignedToName}
                        </Badge>
                      ) : (
                        <span className="font-medium text-amber-700">بدون مسئول</span>
                      )}
                      <span>{faNum(t.messageCount)} پیام</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {faRelativeTime(t.updatedAt)}
                    </span>
                  </span>

                  {t.lastExcerpt ? (
                    <span className="mt-1 block truncate text-xs leading-5 text-muted-foreground/80">
                      {t.lastExcerpt}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Detail sheet */}
      <Sheet
        open={selectedId !== null}
        onOpenChange={(o) => {
          if (!o) closeSheet();
        }}
      >
        <SheetContent side="left" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="space-y-1.5 border-b bg-muted/40 p-4">
            {detail ? (
              <>
                <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span
                    dir="ltr"
                    className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-bold text-secondary-foreground"
                  >
                    #{faNum(detail.number)}
                  </span>
                  <span className="min-w-0 flex-1">{detail.subject}</span>
                  <StatusBadge status={detail.status} label={detail.statusLabel} />
                </SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
                  <span>{detail.departmentName}</span>
                  {detail.conversationId ? (
                    <Badge variant="outline" className="gap-1 border-amber-200 font-normal text-amber-700">
                      <MessageSquare className="h-3 w-3" aria-hidden="true" />
                      پیوسته به گفتگوی زنده
                    </Badge>
                  ) : null}
                  {detail.assignedToName ? <span>مسئول: {detail.assignedToName}</span> : null}
                </SheetDescription>
              </>
            ) : (
              <>
                <SheetTitle>{detailError ? "تیکت" : "در حال دریافت تیکت…"}</SheetTitle>
                <SheetDescription className="text-xs">
                  {detailError ?? "چند لحظه صبر کنید…"}
                </SheetDescription>
              </>
            )}
          </SheetHeader>

          {detailLoading ? (
            <div className="flex flex-1 flex-col gap-3 p-4" aria-hidden="true">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-12 w-3/4 self-start rounded-2xl" />
              <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
            </div>
          ) : detailError ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="rounded-lg border border-dashed p-6 text-center text-sm leading-6 text-muted-foreground">
                {detailError}
              </p>
            </div>
          ) : detail ? (
            <>
              <div className="scroll-slim flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {/* Customer */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {detail.customerName ?? "مراجع ناشناس (گفتگوی زنده)"}
                    </p>
                    {detail.customerMaskedNationalId ? (
                      <p dir="ltr" className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {detail.customerMaskedNationalId}
                      </p>
                    ) : null}
                  </div>
                  {canHistory && detail.customerId ? (
                    <CustomerHistoryDialog customerId={detail.customerId} />
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {canStatus && TICKET_TRANSITIONS[detail.status]?.length > 0
                    ? TICKET_TRANSITIONS[detail.status].map((s) => (
                        <Button
                          key={s}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={actionPending}
                          onClick={() => void changeStatus(s)}
                        >
                          تغییر به {TICKET_STATUS_LABELS[s]}
                        </Button>
                      ))
                    : null}

                  {canAssign ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => void assign()}
                    >
                      <UserRoundCog className="h-4 w-4" aria-hidden="true" />
                      ارجاع خودکار
                    </Button>
                  ) : null}

                  {canAssign ? (
                    <Select onValueChange={(v) => void assign(v)} disabled={actionPending}>
                      <SelectTrigger size="sm" className="w-[190px]" aria-label="ارجاع به اپراتور انتخابی">
                        <SelectValue placeholder={assignees.length === 0 ? "ارجاع‌دهنده‌ای نیست" : "ارجاع به…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {assignees.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} — بار: {faNum(a.activeLoad)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {canTransfer ? (
                    <TransferDialog
                      ticketId={detail.id}
                      currentDepartmentId={detail.departmentId}
                      departments={departments}
                      onTransferred={refreshAll}
                    />
                  ) : null}
                </div>

                <Separator />

                {/* Thread */}
                <div
                  ref={detailScrollRef}
                  role="log"
                  aria-live="polite"
                  aria-label="مکاتبات تیکت"
                  className="flex flex-col gap-3"
                >
                  {detail.messages.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      هنوز پیامی در این تیکت ثبت نشده است.
                    </p>
                  ) : (
                    detail.messages.map((m) => <TicketBubble key={m.id} message={m} />)
                  )}
                </div>

                {/* Status history */}
                {detail.statusHistory.length > 0 ? (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-fit gap-1.5 text-xs text-muted-foreground"
                      >
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        تاریخچه وضعیت
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="mt-1 space-y-2 rounded-lg border border-dashed p-3">
                        {detail.statusHistory.map((h) => (
                          <li key={h.id} className="text-xs leading-5 text-muted-foreground">
                            <span className="flex flex-wrap items-center gap-1">
                              <span>
                                {h.fromStatus
                                  ? `${TICKET_STATUS_LABELS[h.fromStatus as TicketStatus] ?? h.fromStatus} → ${TICKET_STATUS_LABELS[h.toStatus as TicketStatus] ?? h.toStatus}`
                                  : `ایجاد تیکت (${TICKET_STATUS_LABELS[h.toStatus as TicketStatus] ?? h.toStatus})`}
                              </span>
                              {h.actorLabel ? <span className="text-foreground/70">— {h.actorLabel}</span> : null}
                              <span className="text-[10px]">{faDateTimeFormat(h.createdAt)}</span>
                            </span>
                            {h.note ? <span className="block text-[11px] opacity-80">{h.note}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </div>

              {/* Composer */}
              <div className="space-y-2 border-t p-4">
                {composerBlocked ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                    این تیکت پایان‌یافته است و ارسال پاسخ ممکن نیست؛ برای پاسخ، ابتدا با دکمه «تغییر به جدید» آن را بازگشایی کنید.
                  </p>
                ) : canReply ? (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitReply();
                    }}
                  >
                    <Textarea
                      rows={3}
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      placeholder={internalNote ? "یادداشت داخلی — فقط اپراتورها می‌بینند…" : "پاسخ خود را بنویسید…"}
                      aria-label={internalNote ? "متن یادداشت داخلی" : "متن پاسخ اپراتور"}
                      maxLength={4000}
                      disabled={replyPending}
                      className="min-h-11 resize-none"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {canNote ? (
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                              checked={internalNote}
                              onCheckedChange={setInternalNote}
                              disabled={replyPending}
                              aria-label="ارسال به‌عنوان یادداشت داخلی"
                            />
                            یادداشت داخلی
                          </span>
                        ) : null}
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          className="sr-only"
                          onChange={(e) => {
                            const picked = Array.from(e.target.files ?? []);
                            setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
                            e.target.value = "";
                          }}
                          aria-hidden="true"
                          tabIndex={-1}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={replyPending || files.length >= MAX_FILES}
                        >
                          <Paperclip className="h-4 w-4" aria-hidden="true" />
                          پیوست ({faNum(files.length)}/{faNum(MAX_FILES)})
                        </Button>
                        {files.length > 0 ? (
                          <ul className="flex flex-wrap gap-1.5">
                            {files.map((f, i) => (
                              <li
                                key={`${f.name}-${i}`}
                                className="inline-flex max-w-44 items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-1 text-[11px]"
                              >
                                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 truncate">{f.name}</span>
                                <button
                                  type="button"
                                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                                  className="text-muted-foreground hover:text-destructive"
                                  aria-label={`حذف پیوست ${f.name}`}
                                >
                                  <X className="h-3 w-3" aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        className="min-h-11"
                        disabled={replyPending || replyDraft.trim().length < 1}
                      >
                        <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                        {replyPending ? "در حال ارسال…" : internalNote ? "ثبت یادداشت" : "ارسال پاسخ"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    برای ارسال پاسخ یا یادداشت داخلی مجوز لازم را ندارید.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
