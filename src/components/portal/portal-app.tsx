"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Inbox,
  KeyRound,
  LogIn,
  LogOut,
  Paperclip,
  SendHorizontal,
  ShieldCheck,
  TicketCheck,
  UserRound,
  X,
  type LucideIcon,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getDepartmentIcon } from "@/lib/department-icons";
import { faBytes, faDateTimeFormat, faNum } from "@/lib/format";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------- types --

export type PortalDepartment = {
  id: string;
  name: string;
  iconKey: string;
  description: string | null;
};

type CustomerView = {
  id: string;
  fullName: string;
  maskedNationalId: string;
  status: string;
  createdAt: string;
};

type TicketListItem = {
  id: string;
  number: number;
  subject: string;
  status: string;
  statusLabel: string;
  departmentId: string;
  departmentName: string;
  assignedToId: string | null;
  assignedToName: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastExcerpt: string | null;
};

type AttachmentView = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type MessageView = {
  id: string;
  authorType: "CUSTOMER" | "OPERATOR" | "SYSTEM";
  authorLabel: string | null;
  content: string;
  isInternalNote: boolean;
  createdAt: string;
  attachments: AttachmentView[];
};

type TicketDetail = {
  id: string;
  number: number;
  subject: string;
  status: string;
  statusLabel: string;
  departmentName: string;
  assignedToName: string | null;
  createdAt: string;
  messages: MessageView[];
};

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  readAt: string | null;
  createdAt: string;
};

type CreatedTicket = {
  number: number;
  subject: string;
  assignedToName: string | null;
  queued: boolean;
};

// ----------------------------------------------------------------- consts --

const POLL_INTERVAL_MS = 20_000;
const MAX_FILES = 5;
const ACCEPTED_EXT = ".pdf,.png,.jpg,.webp,.zip,.docx,.txt";
const MAX_CONTENT_CHARS = 4000;
const NATIONAL_ID_PLACEHOLDER = "۰۰۱۲۳۴۵۶۷۸";

// ---------------------------------------------------------------- helpers --

type PortalResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

/**
 * Status-aware fetch helper for the portal endpoints (relative URLs only).
 * Keeps the HTTP status so the UI can react to 401 (expired portal session)
 * without leaking any detail about the failure reason.
 */
async function portalRequest<T>(url: string, init?: RequestInit): Promise<PortalResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: string }
      | null;
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        error: body && !body.ok ? body.error : "خطای غیرمنتظره در ارتباط با سرور.",
        status: res.status,
      };
    }
    return { ok: true, data: body.data, status: res.status };
  } catch {
    return { ok: false, error: "ارتباط با سرور برقرار نشد.", status: 0 };
  }
}

/** Persian relative time ("۳ دقیقه پیش") with absolute fallback for older dates. */
function faRelative(value: string): string {
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

function StatusBadge({ status, label }: { status: string; label: string }) {
  if (status === "RESOLVED") {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
        {label}
      </Badge>
    );
  }
  if (status === "CLOSED") {
    return (
      <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
        {label}
      </Badge>
    );
  }
  if (status === "IN_PROGRESS") return <Badge variant="secondary">{label}</Badge>;
  if (status === "WAITING_CUSTOMER") return <Badge variant="outline">{label}</Badge>;
  return <Badge variant="default">{label}</Badge>;
}

/** Chosen-file chips with per-file remove (44px touch target). */
function FileChips({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="فایل‌های انتخاب‌شده">
      {files.map((file, index) => (
        <li
          key={`${file.name}-${index}`}
          className="inline-flex max-w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1 text-xs"
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="max-w-[170px] truncate">{file.name}</span>
          <span className="shrink-0 text-muted-foreground">{faBytes(file.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
            aria-label={`حذف فایل ${file.name}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Shared multi-file picker (max 5, same allowlist as the server). */
function AttachmentPicker({
  files,
  setFiles,
  disabled,
}: {
  files: File[];
  setFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  return (
    <div className="space-y-2">
      <label
        className={cn(
          "inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        افزودن پیوست
        <input
          type="file"
          multiple
          accept={ACCEPTED_EXT}
          className="sr-only"
          disabled={disabled}
          aria-label="انتخاب فایل‌های پیوست (حداکثر ۵ فایل)"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (chosen.length === 0) return;
            const total = files.length + chosen.length;
            if (total > MAX_FILES) {
              toast({
                title: "سقف پیوست‌ها",
                description: `حداکثر ${faNum(MAX_FILES)} فایل در هر ارسال مجاز است؛ ${faNum(total - MAX_FILES)} فایل نادیده گرفته شد.`,
                variant: "destructive",
              });
            }
            setFiles([...files, ...chosen].slice(0, MAX_FILES));
          }}
        />
      </label>
      <FileChips files={files} onRemove={(index) => setFiles(files.filter((_, i) => i !== index))} />
      <p className="text-[11px] leading-4 text-muted-foreground">
        پسوندهای مجاز: pdf، png، jpg، webp، zip، docx، txt — حداکثر {faNum(MAX_FILES)} فایل، هر یک تا ۱۰ مگابایت.
      </p>
    </div>
  );
}

/**
 * Thread bubble. Spec: customer messages align RIGHT, operator messages
 * align LEFT (RTL layout: flex-start = right edge, flex-end = left edge).
 */
function MessageBubble({ message }: { message: MessageView }) {
  if (message.authorType === "SYSTEM") {
    return (
      <p className="max-w-[85%] self-center rounded-lg bg-muted px-3 py-1.5 text-center text-xs leading-5 text-muted-foreground">
        {message.content}
      </p>
    );
  }
  const isCustomer = message.authorType === "CUSTOMER";
  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col gap-1",
        isCustomer ? "items-start self-start" : "items-end self-end"
      )}
    >
      <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {message.authorLabel ?? (isCustomer ? "شما" : "اپراتور")}
        </span>
        <span>{faDateTimeFormat(message.createdAt)}</span>
      </div>
      <div
        className={cn(
          "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-6",
          isCustomer
            ? "rounded-ss-sm bg-primary text-primary-foreground"
            : "rounded-se-sm bg-muted text-foreground"
        )}
      >
        {message.content}
      </div>
      {message.attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {message.attachments.map((att) => (
            <a
              key={att.id}
              href={`/api/public/portal/attachments/${att.id}`}
              download
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[160px] truncate">{att.filename}</span>
              <span className="shrink-0 text-muted-foreground">{faBytes(att.sizeBytes)}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyHint({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed p-8 text-center text-sm leading-6 text-muted-foreground">
      <Icon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
      {children}
    </div>
  );
}

// ------------------------------------------------------------ main component --

export function PortalApp({ departments }: { departments: PortalDepartment[] }) {
  const { toast } = useToast();

  // ---- session (cookie is the source of truth; state mirrors /me) ----
  const [booting, setBooting] = useState(true);
  const [customer, setCustomer] = useState<CustomerView | null>(null);

  // ---- create-ticket form ----
  const [form, setForm] = useState({
    nationalId: "",
    fullName: "",
    password: "",
    passwordConfirm: "",
    departmentId: "",
    subject: "",
    content: "",
  });
  const [formFiles, setFormFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  // ---- citizen login (پیگیری با کد ملی + رمز عبور) ----
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // ---- self-service password change (logged-in citizen) ----
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwPending, setPwPending] = useState(false);

  // ---- ticket history ----
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [sendingReply, setSendingReply] = useState(false);

  // ---- notifications ----
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  // ------------------------------------------------------ data loading --

  const refreshHistory = useCallback(async () => {
    const ticketsRes = await portalRequest<{ tickets: TicketListItem[] }>("/api/public/portal/tickets");
    if (ticketsRes.status === 401) {
      // Portal session expired mid-use — drop back to the login step.
      setCustomer(null);
      setSelectedId(null);
      setDetail(null);
      toast({
        title: "نشست شما منقضی شد",
        description: "برای ادامه، دوباره با کد ملی و رمز عبور وارد شوید.",
        variant: "destructive",
      });
      return;
    }
    if (ticketsRes.ok) setTickets(ticketsRes.data.tickets);

    const notifRes = await portalRequest<{ notifications: NotificationItem[]; unreadCount: number }>(
      "/api/public/portal/notifications"
    );
    if (notifRes.ok) {
      setNotifications(notifRes.data.notifications);
      setUnreadCount(notifRes.data.unreadCount);
    }
  }, [toast]);

  // Bootstrap: resolve the portal session once on mount.
  useEffect(() => {
    let cancelled = false;
    portalRequest<{ customer: CustomerView | null }>("/api/public/portal/me")
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data.customer) setCustomer(res.data.customer);
        setBooting(false);
      })
      .catch(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load + poll history while verified (20s).
  useEffect(() => {
    if (!customer) return;
    let cancelled = false;

    const initialLoad = async () => {
      setTicketsLoading(true);
      try {
        await refreshHistory();
      } finally {
        if (!cancelled) setTicketsLoading(false);
      }
    };
    void initialLoad();

    const timer = window.setInterval(() => {
      void refreshHistory();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [customer, refreshHistory]);

  // Load the selected ticket detail (server filters internal notes).
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    const load = async () => {
      const res = await portalRequest<{ ticket: TicketDetail }>(`/api/public/portal/tickets/${selectedId}`);
      if (cancelled) return;
      if (res.ok) {
        setDetail(res.data.ticket);
      } else {
        setDetail(null);
        if (res.status === 404) {
          setSelectedId(null);
        } else {
          toast({ title: "دریافت جزئیات تیکت ناموفق بود", description: res.error, variant: "destructive" });
        }
      }
      setDetailLoading(false);
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedId, toast]);

  // --------------------------------------------------------- actions --

  const loginCitizen = useCallback(async () => {
    if (loginPending) return;
    setLoginPending(true);
    setLoginError(null);
    const res = await portalRequest<{ customer: CustomerView }>("/api/public/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nationalId: loginId, password: loginPassword }),
    });
    setLoginPending(false);
    if (!res.ok) {
      setLoginError(res.error);
      return;
    }
    setCustomer(res.data.customer);
    setLoginId("");
    setLoginPassword("");
    toast({
      title: `خوش آمدید، ${res.data.customer.fullName}`,
      description: "تاریخچه و گفتگوی تیکت‌های شما در دسترس است.",
    });
  }, [loginPending, loginId, loginPassword, toast]);

  const changePassword = useCallback(async () => {
    if (pwPending) return;
    if (pwNew !== pwConfirm) {
      toast({ title: "تکرار رمز ناهم‌خوان است", description: "رمز جدید و تکرار آن یکسان نیستند.", variant: "destructive" });
      return;
    }
    setPwPending(true);
    const res = await portalRequest<{ changed: boolean }>("/api/public/portal/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
    });
    setPwPending(false);
    if (!res.ok) {
      toast({ title: "تغییر رمز ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setPwOpen(false);
    setPwCurrent("");
    setPwNew("");
    setPwConfirm("");
    toast({ title: "رمز عبور با موفقیت تغییر کرد", description: "از این پس با رمز جدید وارد شوید." });
  }, [pwPending, pwNew, pwConfirm, pwCurrent, toast]);

  const logout = useCallback(async () => {
    await portalRequest<{ loggedOut: boolean }>("/api/public/portal/logout", { method: "POST" });
    setCustomer(null);
    setTickets([]);
    setNotifications([]);
    setUnreadCount(0);
    setSelectedId(null);
    setDetail(null);
    setReply("");
    setReplyFiles([]);
    toast({ title: "از حساب خود خارج شدید" });
  }, [toast]);

  const submitTicket = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      if (form.password !== form.passwordConfirm) {
        setCreateError("رمز عبور و تکرار آن یکسان نیستند.");
        return;
      }
      setSubmitting(true);
      setCreateError(null);
      const fd = new FormData();
      fd.set("nationalId", form.nationalId);
      fd.set("fullName", form.fullName);
      fd.set("password", form.password);
      fd.set("departmentId", form.departmentId);
      fd.set("subject", form.subject);
      fd.set("content", form.content);
      for (const f of formFiles) fd.append("files", f);

      const res = await portalRequest<{ number: number; subject: string; assignedToName: string | null; queued: boolean }>(
        "/api/public/portal/tickets",
        { method: "POST", body: fd }
      );
      setSubmitting(false);
      if (!res.ok) {
        setCreateError(res.error);
        return;
      }
      setCreated({
        number: res.data.number,
        subject: res.data.subject,
        assignedToName: res.data.assignedToName,
        queued: res.data.queued,
      });
      setForm({ nationalId: "", fullName: "", password: "", passwordConfirm: "", departmentId: "", subject: "", content: "" });
      setFormFiles([]);
      toast({ title: "تیکت ثبت شد", description: `شماره تیکت: ${faNum(res.data.number)}` });
      if (customer) void refreshHistory();
    },
    [submitting, form, formFiles, customer, refreshHistory, toast]
  );

  const refreshDetail = useCallback(
    async (ticketId: string) => {
      const res = await portalRequest<{ ticket: TicketDetail }>(`/api/public/portal/tickets/${ticketId}`);
      if (res.ok) setDetail(res.data.ticket);
      await refreshHistory();
    },
    [refreshHistory]
  );

  const sendReply = useCallback(async () => {
    if (!selectedId || sendingReply) return;
    const content = reply.trim();
    if (content.length < 1) return;
    setSendingReply(true);
    const fd = new FormData();
    fd.set("content", content);
    for (const f of replyFiles) fd.append("files", f);

    const res = await portalRequest(`/api/public/portal/tickets/${selectedId}/messages`, {
      method: "POST",
      body: fd,
    });
    setSendingReply(false);
    if (!res.ok) {
      toast({ title: "ارسال پاسخ ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setReply("");
    setReplyFiles([]);
    toast({ title: "پاسخ شما ثبت شد", description: "تیکت در صورت نیاز بازگشایی و به اپراتور اعلام می‌شود." });
    await refreshDetail(selectedId);
  }, [selectedId, sendingReply, reply, replyFiles, refreshDetail, toast]);

  const markRead = useCallback(
    async (ids?: string[]) => {
      const res = await portalRequest<{ updated: number }>("/api/public/portal/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!res.ok) {
        toast({ title: "به‌روزرسانی اعلان‌ها ناموفق بود", description: res.error, variant: "destructive" });
        return;
      }
      await refreshHistory();
    },
    [refreshHistory, toast]
  );

  function handleNotificationClick(n: NotificationItem) {
    if (!n.readAt) void markRead([n.id]);
    if (n.ticketId) selectTicket(n.ticketId);
  }

  /** Open a ticket: clear the previous detail immediately to avoid stale content. */
  function selectTicket(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
  }

  function resetCreateForm() {
    setCreated(null);
    setCreateError(null);
    setForm({ nationalId: "", fullName: "", password: "", passwordConfirm: "", departmentId: "", subject: "", content: "" });
    setFormFiles([]);
  }

  // --------------------------------------------------------- render --

  return (
    <Tabs defaultValue="create" className="w-full">
      <TabsList className="grid h-11 w-full grid-cols-2">
        <TabsTrigger value="create" className="gap-1.5">
          <TicketCheck className="h-4 w-4" aria-hidden="true" />
          ثبت تیکت
        </TabsTrigger>
        <TabsTrigger value="history" className="gap-1.5">
          <History className="h-4 w-4" aria-hidden="true" />
          پیگیری تیکت‌ها
        </TabsTrigger>
      </TabsList>

      {/* ------------------------------------------------ ثبت تیکت -- */}
      <TabsContent value="create" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ثبت تیکت جدید</CardTitle>
            <CardDescription>
              کد ملی، نام و رمز عبور، حساب شما را می‌سازند؛ اگر قبلاً ثبت‌نام کرده‌اید همان رمز همیشگی خود را وارد کنید.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {created ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
                <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
                </span>
                <p className="text-lg font-bold">تیکت شما با موفقیت ثبت شد</p>
                <p className="text-sm text-muted-foreground">
                  شماره تیکت:{" "}
                  <span dir="ltr" className="font-bold text-foreground tabular-nums">
                    #{faNum(created.number)}
                  </span>
                </p>
                <p className="text-sm">
                  {created.assignedToName
                    ? `به اپراتور «${created.assignedToName}» ارجاع شد.`
                    : "درخواست شما در صف ارجاع قرار گرفت و به‌زودی به اپراتور تخصیص می‌یابد."}
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  <TicketCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  برای پیگیری، از تب «پیگیری تیکت‌ها» با کد ملی و رمز عبور خود وارد شوید.
                </div>
                <Button variant="outline" className="mt-1 min-h-11" onClick={resetCreateForm}>
                  ثبت تیکت جدید
                </Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={(e) => void submitTicket(e)}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="portal-nid-create">کد ملی</Label>
                    <Input
                      id="portal-nid-create"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={20}
                      placeholder={NATIONAL_ID_PLACEHOLDER}
                      className="text-left tabular-nums"
                      value={form.nationalId}
                      onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="portal-name">نام و نام خانوادگی</Label>
                    <Input
                      id="portal-name"
                      maxLength={80}
                      placeholder="مثلاً زهرا محمدی"
                      value={form.fullName}
                      onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-dashed bg-emerald-50/40 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
                    <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    رمز عبور پیگیری
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-emerald-800/80">
                    اگر بار اول است تیکت ثبت می‌کنید، همین رمز، رمز ورود شما به بخش پیگیری خواهد شد؛
                    اگر قبلاً ثبت‌نام کرده‌اید، باید همان رمز قبلی خود را وارد کنید.
                  </p>
                  <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-password">رمز عبور</Label>
                      <Input
                        id="portal-password"
                        type="password"
                        autoComplete="current-password"
                        maxLength={128}
                        placeholder="حداقل ۸ کاراکتر شامل حروف و عدد"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-password-confirm">تکرار رمز عبور</Label>
                      <Input
                        id="portal-password-confirm"
                        type="password"
                        autoComplete="current-password"
                        maxLength={128}
                        placeholder="همان رمز عبور را وارد کنید"
                        value={form.passwordConfirm}
                        onChange={(e) => setForm((f) => ({ ...f, passwordConfirm: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="portal-dept">دپارتمان</Label>
                  <Select
                    value={form.departmentId}
                    onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                    disabled={departments.length === 0}
                  >
                    <SelectTrigger id="portal-dept" className="min-h-11 w-full">
                      <SelectValue placeholder={departments.length === 0 ? "دپارتمانی فعال نیست" : "انتخاب دپارتمان"} />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => {
                        const Icon = getDepartmentIcon(d.iconKey);
                        return (
                          <SelectItem key={d.id} value={d.id}>
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              {d.name}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {departments.length === 0 ? (
                    <p className="text-xs text-destructive" role="alert">
                      در حال حاضر دپارتمانی برای ارائه خدمت فعال نیست؛ بعداً تلاش کنید.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="portal-subject">موضوع</Label>
                  <Input
                    id="portal-subject"
                    maxLength={150}
                    placeholder="خلاصه درخواست خود را بنویسید"
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="portal-content">توضیحات</Label>
                    <span dir="ltr" className="text-[11px] tabular-nums text-muted-foreground">
                      {faNum(form.content.length)} / {faNum(MAX_CONTENT_CHARS)}
                    </span>
                  </div>
                  <Textarea
                    id="portal-content"
                    rows={6}
                    maxLength={MAX_CONTENT_CHARS}
                    placeholder="شرح کامل درخواست، شماره دانشجویی/پرونده یا هر نکته‌ای که به رسیدگی سریع‌تر کمک می‌کند…"
                    className="resize-y"
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>پیوست‌ها (اختیاری)</Label>
                  <AttachmentPicker files={formFiles} setFiles={setFormFiles} disabled={submitting} />
                </div>

                {createError ? (
                  <p className="text-xs leading-5 text-destructive" role="alert">
                    {createError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  className="min-h-11 w-full"
                  disabled={submitting || departments.length === 0}
                >
                  {submitting ? "در حال ثبت…" : "ثبت تیکت"}
                  <TicketCheck className="ms-1 h-4 w-4" aria-hidden="true" />
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ------------------------------------------ پیگیری تیکت‌ها -- */}
      <TabsContent value="history" className="mt-4">
        {booting ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : customer ? (
          <div className="space-y-4">
            {/* Logged-in header chip */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
                  <UserRound className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{customer.fullName}</p>
                  <p dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                    {customer.maskedNationalId}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5"
                  onClick={() => setPwOpen(true)}
                >
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  تغییر رمز
                </Button>
                <Button variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => void logout()}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  خروج
                </Button>
              </div>
            </div>

            {/* Self-service password change (collapsible) */}
            {pwOpen ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                    تغییر رمز عبور
                  </CardTitle>
                  <CardDescription>
                    رمز فعلی را برای تأیید و رمز جدید را برای جایگزینی وارد کنید.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-pw-current">رمز فعلی</Label>
                      <Input
                        id="portal-pw-current"
                        type="password"
                        autoComplete="current-password"
                        maxLength={128}
                        value={pwCurrent}
                        onChange={(e) => setPwCurrent(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-pw-new">رمز جدید</Label>
                      <Input
                        id="portal-pw-new"
                        type="password"
                        autoComplete="new-password"
                        maxLength={128}
                        placeholder="حداقل ۸ کاراکتر، حروف و عدد"
                        value={pwNew}
                        onChange={(e) => setPwNew(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-pw-confirm">تکرار رمز جدید</Label>
                      <Input
                        id="portal-pw-confirm"
                        type="password"
                        autoComplete="new-password"
                        maxLength={128}
                        value={pwConfirm}
                        onChange={(e) => setPwConfirm(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="min-h-11"
                      onClick={() => void changePassword()}
                      disabled={pwPending || pwCurrent.length === 0 || pwNew.length < 8 || pwConfirm.length === 0}
                    >
                      {pwPending ? "در حال ثبت…" : "ثبت رمز جدید"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => {
                        setPwOpen(false);
                        setPwCurrent("");
                        setPwNew("");
                        setPwConfirm("");
                      }}
                    >
                      انصراف
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* Notifications */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    اعلان‌ها
                    {unreadCount > 0 ? (
                      <Badge className="border-amber-200 bg-amber-100 text-amber-900">
                        {faNum(unreadCount)} خوانده‌نشده
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    {unreadCount > 0 ? (
                      <Button variant="ghost" size="sm" className="min-h-11" onClick={() => void markRead()}>
                        علامت‌گذاری به‌عنوان خوانده‌شده
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 w-11"
                      onClick={() => setNotifOpen((v) => !v)}
                      aria-expanded={notifOpen}
                      aria-label={notifOpen ? "بستن اعلان‌ها" : "نمایش اعلان‌ها"}
                    >
                      {notifOpen ? (
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {notifOpen ? (
                <CardContent className="pt-0">
                  <div className="scroll-slim max-h-64 space-y-2 overflow-y-auto pe-1">
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">اعلانی وجود ندارد.</p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleNotificationClick(n)}
                          className={cn(
                            "flex w-full flex-col items-start gap-1 rounded-lg border p-3 text-start transition-colors hover:border-emerald-300 hover:bg-emerald-50/40",
                            n.readAt ? "bg-background" : "border-amber-200 bg-amber-50/60"
                          )}
                        >
                          <span className="flex w-full flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{n.title}</span>
                            {n.ticketNumber !== null ? (
                              <Badge variant="outline" className="text-[11px]">
                                تیکت {faNum(n.ticketNumber)}
                              </Badge>
                            ) : null}
                            {!n.readAt ? (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                            ) : null}
                            <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">
                              {faRelative(n.createdAt)}
                            </span>
                          </span>
                          {n.body ? <span className="text-xs leading-5 text-muted-foreground">{n.body}</span> : null}
                        </button>
                      ))
                    )}
                  </div>
                </CardContent>
              ) : null}
            </Card>

            {/* Tickets list + detail */}
            <div className={cn("grid gap-4", selectedId ? "items-start lg:grid-cols-5" : "grid-cols-1")}>
              {/* List */}
              <div
                aria-label="فهرست تیکت‌ها"
                className={cn("space-y-2.5", selectedId ? "hidden lg:col-span-2 lg:block" : "col-span-1")}
              >
                {ticketsLoading ? (
                  <div className="space-y-2.5" aria-hidden="true">
                    <Skeleton className="h-[84px] w-full rounded-xl" />
                    <Skeleton className="h-[84px] w-full rounded-xl" />
                    <Skeleton className="h-[84px] w-full rounded-xl" />
                  </div>
                ) : tickets.length === 0 ? (
                  <EmptyHint icon={Inbox}>
                    هنوز تیکتی ثبت نکرده‌اید؛ برای شروع از تب «ثبت تیکت» استفاده کنید.
                  </EmptyHint>
                ) : (
                  <div className="scroll-slim max-h-96 space-y-2.5 overflow-y-auto pe-1">
                    {tickets.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => selectTicket(t.id)}
                        className={cn(
                          "flex min-h-[44px] w-full flex-col gap-1.5 rounded-xl border bg-card p-3.5 text-start transition-colors hover:border-emerald-300 hover:bg-emerald-50/40",
                          selectedId === t.id && "border-emerald-400 bg-emerald-50/60"
                        )}
                        aria-current={selectedId === t.id}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-bold tabular-nums" dir="ltr">
                            #{faNum(t.number)}
                          </span>
                          <StatusBadge status={t.status} label={t.statusLabel} />
                        </span>
                        <span className="line-clamp-1 text-sm font-medium">{t.subject}</span>
                        {t.lastExcerpt ? (
                          <span className="line-clamp-1 text-xs text-muted-foreground">{t.lastExcerpt}</span>
                        ) : null}
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {t.departmentName}
                          </span>
                          <span>{faNum(t.messageCount)} پیام</span>
                          <span>{faRelative(t.updatedAt)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Detail */}
              {selectedId ? (
                <div className="lg:col-span-3">
                  {detailLoading ? (
                    <div className="space-y-3" aria-hidden="true">
                      <Skeleton className="h-24 w-full rounded-xl" />
                      <Skeleton className="h-64 w-full rounded-xl" />
                    </div>
                  ) : detail ? (
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <span dir="ltr" className="shrink-0 tabular-nums">
                                #{faNum(detail.number)}
                              </span>
                              <span className="truncate">{detail.subject}</span>
                            </CardTitle>
                            <CardDescription className="mt-1 flex flex-wrap gap-x-3 text-xs">
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                                {detail.departmentName}
                              </span>
                              {detail.assignedToName ? <span>اپراتور: {detail.assignedToName}</span> : null}
                            </CardDescription>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <StatusBadge status={detail.status} label={detail.statusLabel} />
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 lg:hidden"
                              onClick={closeDetail}
                            >
                              بازگشت
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        <div
                          role="log"
                          aria-label="گفتگوی تیکت"
                          className="scroll-slim flex max-h-96 flex-col gap-3 overflow-y-auto rounded-lg border bg-muted/20 p-3"
                        >
                          {detail.messages.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                              هنوز پیامی ثبت نشده است.
                            </p>
                          ) : (
                            detail.messages.map((m) => <MessageBubble key={m.id} message={m} />)
                          )}
                        </div>

                        {/* Reply composer — customer replies reopen RESOLVED/CLOSED tickets server-side */}
                        <form
                          className="space-y-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void sendReply();
                          }}
                        >
                          <Textarea
                            rows={3}
                            maxLength={MAX_CONTENT_CHARS}
                            placeholder="پاسخ یا توضیح تکمیلی خود را بنویسید…"
                            aria-label="متن پاسخ"
                            className="min-h-11 resize-y"
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            disabled={sendingReply}
                          />
                          <div className="flex flex-wrap items-end justify-between gap-2">
                            <AttachmentPicker
                              files={replyFiles}
                              setFiles={setReplyFiles}
                              disabled={sendingReply}
                            />
                            <Button
                              type="submit"
                              className="min-h-11 gap-1.5"
                              disabled={sendingReply || reply.trim().length === 0}
                            >
                              <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                              {sendingReply ? "در حال ارسال…" : "ارسال پاسخ"}
                            </Button>
                          </div>
                          <p className="text-[11px] leading-4 text-muted-foreground">
                            در صورت حل‌شده یا بسته‌بودن تیکت، ارسال این پاسخ آن را به‌صورت خودکار بازگشایی می‌کند.
                          </p>
                        </form>
                      </CardContent>
                    </Card>
                  ) : (
                    <EmptyHint icon={Inbox}>این تیکت در دسترس نیست.</EmptyHint>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          /* Citizen login — کد ملی + password (Phase 8; OTP removed) */
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              برای مشاهده تاریخچه، ادامه گفتگو و پیگیری تیکت‌های خود، با کد ملی و رمز عبوری که هنگام نخستین ثبت وارد کرده‌اید
              وارد شوید. اگر رمز خود را فراموش کرده‌اید، با مدیر سامانه تماس بگیرید.
            </p>
            <Card className="mx-auto max-w-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  ورود مراجعان
                </CardTitle>
                <CardDescription>کد ملی و رمز عبور حساب خود را وارد کنید.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loginCitizen();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="portal-nid-login">کد ملی</Label>
                    <Input
                      id="portal-nid-login"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={20}
                      placeholder={NATIONAL_ID_PLACEHOLDER}
                      className="text-left tabular-nums"
                      value={loginId}
                      onChange={(e) => setLoginId(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="portal-password-login">رمز عبور</Label>
                    <Input
                      id="portal-password-login"
                      type="password"
                      maxLength={128}
                      placeholder="رمز عبور حساب شما"
                      className="text-left"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  {loginError ? (
                    <p className="text-xs leading-5 text-destructive" role="alert">
                      {loginError}
                    </p>
                  ) : null}
                  <Button type="submit" className="min-h-11 w-full" disabled={loginPending || loginId.trim().length < 4 || loginPassword.length === 0}>
                    {loginPending ? "در حال بررسی…" : "ورود به بخش پیگیری"}
                    <LogIn className="ms-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                  <p className="flex items-center justify-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    کد ملی شما محرمانه می‌ماند و هرگز کامل نمایش داده نمی‌شود.
                  </p>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
