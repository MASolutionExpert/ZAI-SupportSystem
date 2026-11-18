"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, SendHorizontal, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/client/api";
import { OPERATOR_POLL_MODES, TranscriptBubble, TypingIndicator, ModeBadge } from "@/components/chat/conversation-ui";
import type { ConversationMode, TranscriptMessage } from "@/lib/conversations/types";

// ------------------------------------------------------------- API payloads --

type CreatePayload = {
  token: string;
  mode: ConversationMode;
  modeLabel: string;
  departmentName: string;
  messages: TranscriptMessage[];
};

type TranscriptPayload = {
  mode: ConversationMode;
  modeLabel: string;
  departmentName: string;
  aiEnabled: boolean;
  escalatedOfferAvailable: boolean;
  messages: TranscriptMessage[];
};

type TurnPayload = {
  userMessage: TranscriptMessage;
  assistantMessage: TranscriptMessage | null;
  escalatedOffer: boolean;
  mode: ConversationMode;
  modeLabel: string;
};

type HandoffPayload = { mode: ConversationMode; modeLabel: string };

type ChatResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

/**
 * Status-aware request helper for the token-keyed chat endpoints. Unlike
 * apiFetch it keeps the HTTP status: the dialog must distinguish 404
 * (stale localStorage token → silently start a new conversation) and
 * 409 (RESOLVED turn / handoff → contract-specific handling).
 */
async function chatRequest<T>(url: string, init?: RequestInit): Promise<ChatResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
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

// ------------------------------------------------------------------ consts --

const TOKEN_KEY_PREFIX = "sd.conv.";
const POLL_INTERVAL_MS = 15000;
const HANDOFF_SYSTEM_TEXT =
  "درخواست شما برای گفتگو با اپراتور ثبت شد و در صف دپارتمان قرار گرفت. اپراتور همین گفتگو را ادامه می‌دهد.";
const NATIONAL_ID_PLACEHOLDER = "۰۰۱۲۳۴۵۶۷۸";

export function PublicChatDialog({
  departmentId,
  departmentName,
  aiEnabled,
  welcomeMessage,
  open,
  onOpenChange,
}: {
  departmentId: string;
  departmentName: string;
  aiEnabled: boolean;
  welcomeMessage: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();

  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [mode, setMode] = useState<ConversationMode | null>(null);
  const [modeLabel, setModeLabel] = useState("");
  const [offerAvailable, setOfferAvailable] = useState(true);
  const [escalatedOffer, setEscalatedOffer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);

  // Phase 8 — citizen identity gate (کد ملی + نام + رمز عبور). The password
  // is set on FIRST contact and is required for پیگیری from the portal; it
  // is NEVER persisted in localStorage.
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [identity, setIdentity] = useState({ nationalId: "", fullName: "", password: "", passwordConfirm: "" });
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityPending, setIdentityPending] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tokenKey = `${TOKEN_KEY_PREFIX}${departmentId}`;

  // ----------------------------------------------------------- state helpers

  const applyTranscript = useCallback((data: TranscriptPayload, nextToken: string) => {
    setToken(nextToken);
    setMessages(data.messages);
    setMode(data.mode);
    setModeLabel(data.modeLabel);
    setOfferAvailable(data.escalatedOfferAvailable);
    // Restored transcripts: re-offer escalation only when the department
    // allows it, the conversation is still AI-assisted and an assistant
    // answer actually exists (matches the last-turn behaviour of sends).
    setEscalatedOffer(
      data.mode === "AI_ASSISTED" &&
        data.escalatedOfferAvailable &&
        data.messages.some((m) => m.role === "ASSISTANT")
    );
  }, []);

  const createConversation = useCallback(
    async (
      identity: { nationalId: string; fullName: string; password: string },
      signal?: { cancelled: boolean }
    ): Promise<boolean> => {
      const created = await chatRequest<CreatePayload>(
        "/api/public/conversations",
        apiJson("POST", {
          departmentId,
          customerName: identity.fullName,
          nationalId: identity.nationalId,
          password: identity.password,
        })
      );
      if (signal?.cancelled) return false;
      if (!created.ok) {
        setIdentityError(created.error);
        setLoading(false);
        setIdentityPending(false);
        return false;
      }
      window.localStorage.setItem(tokenKey, created.data.token);
      setToken(created.data.token);
      setMessages(created.data.messages);
      setMode(created.data.mode);
      setModeLabel(created.data.modeLabel);
      setOfferAvailable(true);
      setEscalatedOffer(false);
      setNeedsIdentity(false);
      setIdentity({ nationalId: "", fullName: "", password: "", passwordConfirm: "" });
      setIdentityError(null);
      setLoading(false);
      setIdentityPending(false);
      return true;
    },
    [departmentId, tokenKey]
  );

  // -------------------------------------------------- bootstrap (on open) --

  useEffect(() => {
    if (!open) return;
    const signal = { cancelled: false };

    (async () => {
      setLoading(true);
      setInlineError(null);

      const stored = window.localStorage.getItem(tokenKey);
      if (stored) {
        const res = await chatRequest<TranscriptPayload>(`/api/public/conversations/${stored}`);
        if (signal.cancelled) return;
        if (res.ok) {
          applyTranscript(res.data, stored);
          setLoading(false);
          return;
        }
        if (res.status === 404) {
          // Conversation no longer exists server-side: drop the stale token
          // and ask for identity to start a fresh conversation.
          window.localStorage.removeItem(tokenKey);
        } else {
          toast({
            title: "دریافت گفتگو ناموفق بود",
            description: res.error,
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
      }

      // No resume token → the citizen identity step is shown first.
      setToken(null);
      setMessages([]);
      setMode(null);
      setNeedsIdentity(true);
      setLoading(false);
    })();

    return () => {
      signal.cancelled = true;
    };
  }, [open, tokenKey, applyTranscript, toast]);

  // --------------------------------------------- polling (operator modes) --

  useEffect(() => {
    if (!open || !token || !mode || !OPERATOR_POLL_MODES.includes(mode)) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const res = await chatRequest<TranscriptPayload>(`/api/public/conversations/${token}`);
      if (cancelled) return;
      if (res.ok) {
        // Dedupe by message count: only replace when the transcript grew.
        setMessages((prev) =>
          prev.length === res.data.messages.length ? prev : res.data.messages
        );
        setMode(res.data.mode);
        setModeLabel(res.data.modeLabel);
        setOfferAvailable(res.data.escalatedOfferAvailable);
        if (res.data.mode !== "AI_ASSISTED") setEscalatedOffer(false);
      }
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, token, mode]);

  // ------------------------------------------------------------ auto-scroll --

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending, loading, mode]);

  // ---------------------------------------------------------------- actions --

  function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (identityPending) return;
    const nationalId = identity.nationalId.trim();
    const fullName = identity.fullName.trim();
    const password = identity.password;
    if (nationalId.length < 4) {
      setIdentityError("کد ملی را کامل وارد کنید.");
      return;
    }
    if (fullName.length < 3) {
      setIdentityError("نام و نام خانوادگی را کامل وارد کنید.");
      return;
    }
    if (password !== identity.passwordConfirm) {
      setIdentityError("رمز عبور و تکرار آن یکسان نیستند.");
      return;
    }
    setIdentityPending(true);
    setIdentityError(null);
    void createConversation({ nationalId, fullName, password });
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!token || !mode || mode === "RESOLVED" || pending || content.length < 2) return;

    setPending(true);
    setInlineError(null);
    setPendingDraft(content);
    setDraft("");

    const res = await chatRequest<TurnPayload>(
      `/api/public/conversations/${token}/messages`,
      apiJson("POST", { content })
    );
    setPending(false);
    setPendingDraft(null);

    if (!res.ok) {
      setDraft(content);
      setInlineError(
        res.status === 409 ? res.error : "ارسال پیام ناموفق بود؛ دوباره تلاش کنید."
      );
      toast({ title: "ارسال پیام ناموفق بود", description: res.error, variant: "destructive" });
      // The conversation may have been resolved server-side in the
      // meantime — reconcile quietly so badges/composer stay honest.
      if (res.status === 409) {
        const sync = await chatRequest<TranscriptPayload>(`/api/public/conversations/${token}`);
        if (sync.ok) applyTranscript(sync.data, token);
      }
      return;
    }

    setMessages((prev) => {
      const next = [...prev, res.data.userMessage];
      if (res.data.assistantMessage) next.push(res.data.assistantMessage);
      return next;
    });
    setMode(res.data.mode);
    setModeLabel(res.data.modeLabel);
    setEscalatedOffer(res.data.escalatedOffer);
  }

  async function requestHandoff() {
    if (!token) return;
    setHandoffPending(true);
    const res = await chatRequest<HandoffPayload>(
      `/api/public/conversations/${token}/handoff`,
      apiJson("POST", {})
    );
    setHandoffPending(false);

    if (!res.ok) {
      // 409 (already resolved) is ignored silently per the API contract.
      if (res.status !== 409) {
        toast({
          title: "ثبت درخواست گفتگو با اپراتور ناموفق بود",
          description: res.error,
          variant: "destructive",
        });
      }
      return;
    }

    setMode(res.data.mode);
    setModeLabel(res.data.modeLabel);
    setEscalatedOffer(false);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-handoff-${Date.now()}`,
        role: "SYSTEM",
        content: HANDOFF_SYSTEM_TEXT,
        sourcesCount: null,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  function startNewConversation() {
    window.localStorage.removeItem(tokenKey);
    setToken(null);
    setMessages([]);
    setInlineError(null);
    setNeedsIdentity(true);
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const showOfferBox =
    !loading && mode === "AI_ASSISTED" && offerAvailable && escalatedOffer;

  // ------------------------------------------------------------------ render --

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1.5 border-b bg-muted/40 p-4 text-start">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>{departmentName}</span>
            {mode && !loading && !needsIdentity ? <ModeBadge mode={mode} label={modeLabel} /> : null}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {welcomeMessage ??
              (aiEnabled
                ? "پاسخ‌گویی بر اساس دانش رسمی سازمان"
                : "پاسخ‌گویی توسط اپراتورهای این دپارتمان")}
          </DialogDescription>
        </DialogHeader>

        {needsIdentity && !loading ? (
          /* ---------------------------------------- identity (کد ملی + رمز) -- */
          <div className="px-4 py-5">
            <form className="space-y-3.5" onSubmit={submitIdentity}>
              <div className="rounded-lg border border-dashed bg-muted/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  شناسایی مراجع
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  گفتگو با کد ملی شما در میز پشتیبانی ثبت می‌شود. اگر بار اول است، رمزی برای پیگیری
                  بعدی تیکت‌ها تعیین کنید؛ اگر قبلاً ثبت‌نام کرده‌اید، همان رمز همیشگی خود را وارد کنید.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="chat-nid">کد ملی</Label>
                <Input
                  id="chat-nid"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={20}
                  placeholder={NATIONAL_ID_PLACEHOLDER}
                  className="text-left tabular-nums"
                  value={identity.nationalId}
                  onChange={(e) => setIdentity((f) => ({ ...f, nationalId: e.target.value }))}
                  autoComplete="username"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="chat-fullname">نام و نام خانوادگی</Label>
                <Input
                  id="chat-fullname"
                  maxLength={80}
                  placeholder="مثلاً زهرا محمدی"
                  value={identity.fullName}
                  onChange={(e) => setIdentity((f) => ({ ...f, fullName: e.target.value }))}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="chat-password">رمز عبور</Label>
                  <Input
                    id="chat-password"
                    type="password"
                    maxLength={128}
                    placeholder="حداقل ۸ کاراکتر، حروف و عدد"
                    value={identity.password}
                    onChange={(e) => setIdentity((f) => ({ ...f, password: e.target.value }))}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="chat-password-confirm">تکرار رمز عبور</Label>
                  <Input
                    id="chat-password-confirm"
                    type="password"
                    maxLength={128}
                    placeholder="همان رمز عبور"
                    value={identity.passwordConfirm}
                    onChange={(e) => setIdentity((f) => ({ ...f, passwordConfirm: e.target.value }))}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              {identityError ? (
                <p className="text-xs leading-5 text-destructive" role="alert">
                  {identityError}
                </p>
              ) : null}

              <Button type="submit" className="min-h-11 w-full" disabled={identityPending}>
                {identityPending ? "در حال شروع گفتگو…" : "شروع گفتگو"}
                <SendHorizontal className="ms-1 h-4 w-4" aria-hidden="true" />
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                کد ملی شما محرمانه می‌ماند و هرگز کامل نمایش داده نمی‌شود.
              </p>
              <p className="flex items-center justify-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                برای پیگیری گفتگو و تیکت‌های بعدی، از «پورتال مراجعان» با همین کد ملی و رمز وارد شوید.
              </p>
            </form>
          </div>
        ) : (
          <>
            {/* Transcript */}
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-label="متن گفتگو"
              className="scroll-slim flex h-[380px] flex-col gap-3 overflow-y-auto px-4 py-4 sm:h-[440px]"
            >
              {loading ? (
                <div className="flex flex-col gap-3" aria-hidden="true">
                  <Skeleton className="h-12 w-3/4 self-start rounded-2xl" />
                  <Skeleton className="h-9 w-1/2 self-end rounded-2xl" />
                  <Skeleton className="h-12 w-2/3 self-start rounded-2xl" />
                </div>
              ) : mode ? (
                <>
                  {messages.map((m) => (
                    <TranscriptBubble key={m.id} message={m} />
                  ))}
                  {pending && pendingDraft !== null ? (
                    <div className="flex max-w-[85%] flex-col items-end gap-0.5 self-end opacity-60">
                      <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary/70 px-3.5 py-2 text-sm leading-6 text-primary-foreground">
                        {pendingDraft}
                      </div>
                    </div>
                  ) : null}
                  {pending ? <TypingIndicator /> : null}
                </>
              ) : (
                <p className="self-center px-4 text-center text-sm leading-6 text-muted-foreground">
                  گفتگو در دسترس نیست؛ پنجره را ببندید و دوباره تلاش کنید.
                </p>
              )}
            </div>

            {/* Operator handoff offer (last-turn flag + department setting) */}
            {showOfferBox ? (
              <div className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs leading-5 text-amber-900">
                  آیا مایلید با اپراتور همین دپارتمان گفتگو کنید؟
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 border-amber-300 text-amber-800 hover:bg-amber-100"
                  onClick={() => void requestHandoff()}
                  disabled={handoffPending}
                >
                  {handoffPending ? "در حال ثبت…" : "ارتباط با اپراتور"}
                </Button>
              </div>
            ) : null}

            {/* Mode banners */}
            {!loading && mode && (mode === "WAITING_FOR_OPERATOR" || mode === "ASSIGNED_TO_OPERATOR") ? (
              <p className="mx-4 mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                پیام شما در صف اپراتورهای دپارتمان است؛ به‌محض پاسخ‌گویی، همین گفتگو ادامه می‌یابد.
              </p>
            ) : null}
            {!loading && mode === "HUMAN_ACTIVE" ? (
              <p className="mx-4 mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                اپراتور در گفتگو حضور دارد.
              </p>
            ) : null}

            {/* Composer */}
            {!loading && mode ? (
              <div className="border-t p-3">
                {mode === "RESOLVED" ? (
                  <div className="flex flex-col items-center gap-2 py-1 text-center">
                    <p className="text-xs leading-5 text-muted-foreground">
                      این گفتگو پایان یافته است؛ برای سؤال جدید، کارت دپارتمان را دوباره باز کنید.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void startNewConversation()}
                    >
                      گفتگوی جدید
                    </Button>
                  </div>
                ) : (
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void sendMessage();
                    }}
                  >
                    <Textarea
                      rows={2}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      placeholder="پیام خود را بنویسید…"
                      aria-label="متن پیام"
                      maxLength={2000}
                      disabled={pending}
                      className="min-h-11 resize-none"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label="ارسال پیام"
                      disabled={pending || draft.trim().length < 2}
                    >
                      <SendHorizontal className="h-4.5 w-4.5" aria-hidden="true" />
                    </Button>
                  </form>
                )}
                {inlineError ? (
                  <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
                    {inlineError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
