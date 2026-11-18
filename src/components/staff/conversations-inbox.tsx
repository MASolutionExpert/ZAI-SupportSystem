"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessagesSquare, RefreshCw, SendHorizontal } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import { faDateTimeFormat, faNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ModeBadge, TranscriptBubble } from "@/components/chat/conversation-ui";
import type { ConversationMode, TranscriptMessage } from "@/lib/conversations/types";

// ------------------------------------------------------------- API payloads --

type StaffConversationSummary = {
  id: string;
  mode: ConversationMode;
  modeLabel: string;
  departmentId: string;
  departmentName: string;
  customerName: string | null;
  customerNationalIdMasked: string | null;
  messageCount: number;
  lastMessageAt: string;
  lastMessageExcerpt: string | null;
  assignedToName: string | null;
};

type StaffConversationDetail = StaffConversationSummary & { messages: TranscriptMessage[] };

type ReplyPayload = {
  message: TranscriptMessage;
  conversation: { mode: ConversationMode; modeLabel: string };
};

type ModePayload = { conversation: { mode: ConversationMode; modeLabel: string } };

type ConversationFilter = "active" | "resolved" | "all";

const FILTER_OPTIONS: { value: ConversationFilter; label: string }[] = [
  { value: "active", label: "فعال" },
  { value: "resolved", label: "پایان‌یافته" },
  { value: "all", label: "همه" },
];

const EMPTY_TEXTS: Record<ConversationFilter, string> = {
  active: "گفتگویی در صف نیست.",
  resolved: "گفتگوی پایان‌یافته‌ای ثبت نشده است.",
  all: "هنوز گفتگویی ثبت نشده است.",
};

const AUTO_REFRESH_MS = 20000;

async function fetchConversations(f: ConversationFilter) {
  return apiFetch<{ conversations: StaffConversationSummary[] }>(
    `/api/staff/conversations?filter=${f}`
  );
}

/** Confirmation dialog for closing a conversation (destructive action). */
function ResolveConversationDialog({
  onConfirm,
  disabled,
  fullWidth,
}: {
  onConfirm: () => void;
  disabled: boolean;
  fullWidth?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "border-destructive/30 text-destructive hover:bg-destructive/10",
            fullWidth && "w-full"
          )}
          disabled={disabled}
        >
          پایان گفتگو
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>پایان دادن به گفتگو</AlertDialogTitle>
          <AlertDialogDescription>
            با پایان دادن، مراجع دیگر نمی‌تواند در این گفتگو پیام جدیدی ثبت کند و پیام پایانی برای او نمایش داده می‌شود. این اقدام قابل بازگشت نیست.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>پایان گفتگو</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConversationsInbox({
  canReply,
  canResolve,
  departments,
}: {
  canReply: boolean;
  canResolve: boolean;
  departments: { id: string; name: string }[];
}) {
  const { toast } = useToast();

  const [filter, setFilter] = useState<ConversationFilter>("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [items, setItems] = useState<StaffConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyPending, setReplyPending] = useState(false);
  const [resolving, setResolving] = useState(false);

  const detailScrollRef = useRef<HTMLDivElement | null>(null);

  // ------------------------------------------------------------------ list --

  // Manual / post-action refresh. Only invoked from event handlers and the
  // auto-refresh interval callback (never synchronously inside an effect).
  const reload = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const res = await fetchConversations(filter);
      if (silent) setRefreshing(false);
      else setLoading(false);
      if (res.ok) {
        setItems(res.data.conversations);
      } else if (!silent) {
        toast({ title: "دریافت گفتگوها ناموفق بود", description: res.error, variant: "destructive" });
      }
    },
    [filter, toast]
  );

  // Initial load + reload whenever the status filter changes. All state
  // updates happen after await (never synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchConversations(filter);
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setItems(res.data.conversations);
      } else {
        toast({ title: "دریافت گفتگوها ناموفق بود", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, toast]);

  // Auto-refresh the list every 20 s (silent; reconciles rows even while
  // the transcript sheet is open).
  useEffect(() => {
    const id = window.setInterval(() => {
      void reload(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  const visible =
    departmentFilter === "all"
      ? items
      : items.filter((c) => c.departmentId === departmentFilter);

  // --------------------------------------------------------------- transcript --

  // Row click (event handler): reset transcript state synchronously, then
  // the effect below fetches the full transcript for the selected row.
  function openSheet(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setReplyDraft("");
    setDetailLoading(true);
  }

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    (async () => {
      const res = await apiFetch<{ conversation: StaffConversationDetail }>(
        `/api/staff/conversations/${selectedId}`
      );
      if (cancelled) return;
      setDetailLoading(false);
      if (res.ok) setDetail(res.data.conversation);
      else setDetailError(res.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    const el = detailScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.messages.length, detailLoading]);

  function closeSheet() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setReplyDraft("");
    setDetailLoading(false);
  }

  async function submitReply() {
    if (!detail) return;
    const content = replyDraft.trim();
    if (content.length < 2 || replyPending) return;

    setReplyPending(true);
    const res = await apiFetch<ReplyPayload>(
      `/api/staff/conversations/${detail.id}/reply`,
      apiJson("POST", { content })
    );
    setReplyPending(false);

    if (!res.ok) {
      toast({ title: "ارسال پاسخ ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }

    setReplyDraft("");
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, res.data.message],
            mode: res.data.conversation.mode,
            modeLabel: res.data.conversation.modeLabel,
            lastMessageExcerpt: res.data.message.content,
            lastMessageAt: res.data.message.createdAt,
            messageCount: prev.messageCount + 1,
          }
        : prev
    );
    toast({ title: "پاسخ ثبت شد و گفتگو به حالت اپراتور رفت" });
    void reload(true);
  }

  async function resolveNow() {
    if (!detail) return;
    setResolving(true);
    const res = await apiFetch<ModePayload>(
      `/api/staff/conversations/${detail.id}/resolve`,
      apiJson("POST", {})
    );
    setResolving(false);

    if (!res.ok) {
      toast({ title: "پایان گفتگو ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }

    setDetail((prev) =>
      prev
        ? {
            ...prev,
            mode: res.data.conversation.mode,
            modeLabel: res.data.conversation.modeLabel,
          }
        : prev
    );
    toast({ title: "گفتگو پایان یافته و برای مراجع بسته شد" });
    void reload(true);
  }

  // ------------------------------------------------------------------ render --

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
          گفتگوهای مراجعان
        </CardTitle>
        <CardDescription className="text-xs">
          گفتگوهای زنده دپارتمان‌های در دامنه شما؛ ارجاع مراجعان از کارت‌های صفحه اصلی به همین فهرست می‌رسد.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as ConversationFilter)}>
            <SelectTrigger size="sm" className="w-[130px]" aria-label="فیلتر وضعیت گفتگو">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger size="sm" className="w-[190px]" aria-label="فیلتر دپارتمان">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه دپارتمان‌های در دامنه</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="به‌روزرسانی فهرست گفتگوها"
            onClick={() => void reload()}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[88px] rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {EMPTY_TEXTS[filter]}
          </p>
        ) : (
          <ul className="scroll-slim flex max-h-96 flex-col gap-2 overflow-y-auto pe-1">
            {visible.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openSheet(c.id)}
                  aria-haspopup="dialog"
                  className="w-full cursor-pointer rounded-lg border p-3 text-start transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                        {c.departmentName}
                      </Badge>
                      <ModeBadge mode={c.mode} label={c.modeLabel} />
                    </span>
                    <span className="shrink-0 text-[10px] leading-4 text-muted-foreground">
                      {faDateTimeFormat(c.lastMessageAt)}
                    </span>
                  </span>
                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {c.customerName ?? "مراجع"}
                      </span>
                      {c.customerNationalIdMasked ? (
                        <span dir="ltr" className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {c.customerNationalIdMasked}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {faNum(c.messageCount)} پیام
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs leading-5 text-muted-foreground">
                    {c.lastMessageExcerpt ?? "—"}
                  </span>
                  {c.assignedToName ? (
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      اپراتور: {c.assignedToName}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* Transcript sheet */}
      <Sheet
        open={selectedId !== null}
        onOpenChange={(o) => {
          if (!o) closeSheet();
        }}
      >
        <SheetContent side="left" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b bg-muted/40 p-4">
            <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
              {detail ? (detail.customerName ?? "مراجع") : "گفتگوی مراجع"}
              {detail ? <ModeBadge mode={detail.mode} label={detail.modeLabel} /> : null}
            </SheetTitle>
            <SheetDescription className="text-xs leading-5">
              {detail ? `${detail.departmentName} — ${faNum(detail.messageCount)} پیام` : "در حال دریافت متن گفتگو…"}
            </SheetDescription>
          </SheetHeader>

          {detailLoading ? (
            <div className="flex flex-1 flex-col gap-3 p-4" aria-hidden="true">
              <Skeleton className="h-12 w-3/4 self-start rounded-2xl" />
              <Skeleton className="h-9 w-1/2 self-end rounded-2xl" />
              <Skeleton className="h-12 w-2/3 self-start rounded-2xl" />
            </div>
          ) : detailError ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="rounded-lg border border-dashed p-6 text-center text-sm leading-6 text-muted-foreground">
                {detailError}
              </p>
            </div>
          ) : detail ? (
            <>
              <div
                ref={detailScrollRef}
                role="log"
                aria-live="polite"
                aria-label="متن گفتگو"
                className="scroll-slim flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
              >
                {detail.messages.map((m) => (
                  <TranscriptBubble key={m.id} message={m} />
                ))}
              </div>

              {detail.mode === "WAITING_FOR_OPERATOR" || detail.mode === "ASSIGNED_TO_OPERATOR" ? (
                <p className="mx-4 mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  این گفتگو در صف پاسخ‌گویی اپراتور است؛ با ثبت پاسخ، گفتگو به شما اختصاص می‌یابد.
                </p>
              ) : null}

              <div className="space-y-2 border-t p-4">
                {detail.mode === "RESOLVED" ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    این گفتگو پایان یافته است؛ ارسال پاسخ دیگر ممکن نیست.
                  </p>
                ) : (
                  <>
                    {canReply ? (
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
                          placeholder="پاسخ خود را بنویسید…"
                          aria-label="متن پاسخ اپراتور"
                          maxLength={2000}
                          disabled={replyPending}
                          className="min-h-11 resize-none"
                        />
                        <div className="flex items-center justify-between gap-2">
                          {canResolve ? (
                            <ResolveConversationDialog
                              onConfirm={() => void resolveNow()}
                              disabled={resolving}
                            />
                          ) : (
                            <span />
                          )}
                          <Button
                            type="submit"
                            size="sm"
                            className="min-h-11"
                            disabled={replyPending || replyDraft.trim().length < 2}
                          >
                            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                            {replyPending ? "در حال ارسال…" : "ارسال پاسخ"}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <p className="text-xs leading-5 text-muted-foreground">
                        برای ارسال پاسخ مجوز لازم را ندارید.
                        {canResolve ? " در صورت نیاز می‌توانید گفتگو را پایان دهید." : ""}
                      </p>
                    )}
                    {canResolve && !canReply ? (
                      <ResolveConversationDialog
                        onConfirm={() => void resolveNow()}
                        disabled={resolving}
                        fullWidth
                      />
                    ) : null}
                  </>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
