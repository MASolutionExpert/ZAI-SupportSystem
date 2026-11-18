"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import { faNum } from "@/lib/format";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------ API payloads --

type OperatorNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  readAt: string | null;
  createdAt: string;
};

const POLL_MS = 30000;

function unreadBadgeText(count: number): string {
  return count > 99 ? "۹۹+" : faNum(count);
}

function faRelativeTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const minutes = Math.floor((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${faNum(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faNum(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${faNum(days)} روز پیش`;
  return faNum(Math.floor(days / 30)) + " ماه پیش";
}

/**
 * Staff notification bell — polls the operator feed every 30 s, shows the
 * unread badge and lets the user mark items (or all) as read.
 */
export function NotificationsBell() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OperatorNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ notifications: OperatorNotification[]; unreadCount: number }>(
      "/api/staff/notifications"
    );
    if (!res.ok) return;
    setItems(res.data.notifications);
    setUnreadCount(res.data.unreadCount);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ notifications: OperatorNotification[]; unreadCount: number }>(
        "/api/staff/notifications"
      );
      if (cancelled || !res.ok) return;
      setItems(res.data.notifications);
      setUnreadCount(res.data.unreadCount);
      setLoading(false);
    })();
    const id = window.setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load]);

  async function markRead(ids?: string[]) {
    const res = await apiFetch<{ marked: number }>(
      "/api/staff/notifications",
      apiJson("POST", ids ? { ids } : {})
    );
    if (!res.ok) {
      toast({
        title: "ثبت خوانده‌شدن ناموفق بود",
        description: res.error,
        variant: "destructive",
      });
      return;
    }
    await load();
  }

  const hasUnread = unreadCount > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label={`اعلان‌ها${hasUnread ? ` (${faNum(unreadCount)} خوانده‌نشده)` : ""}`}
        >
          <Bell className="h-4.5 w-4.5" aria-hidden="true" />
          {hasUnread ? (
            <span
              className="absolute -end-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
              aria-hidden="true"
            >
              {unreadBadgeText(unreadCount)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <p className="text-sm font-semibold">اعلان‌ها</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            disabled={!hasUnread || markingAll}
            onClick={() => {
              setMarkingAll(true);
              void markRead().finally(() => setMarkingAll(false));
            }}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            علامت‌گذاری همه به‌عنوان خوانده‌شده
          </Button>
        </div>

        <div className="scroll-slim max-h-96 overflow-y-auto" role="list" aria-label="فهرست اعلان‌ها">
          {loading ? (
            <div className="space-y-2 p-3" aria-hidden="true">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">اعلانی ندارید.</p>
          ) : (
            <ul className="flex flex-col">
              {items.map((n) => {
                const unread = n.readAt === null;
                return (
                  <li key={n.id} role="listitem">
                    <button
                      type="button"
                      onClick={() => {
                        if (unread) void markRead([n.id]);
                      }}
                      disabled={!unread}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 border-b px-3 py-2.5 text-start transition-colors last:border-b-0",
                        unread ? "bg-muted/40 hover:bg-muted/70" : "hover:bg-muted/40"
                      )}
                      title={unread ? "علامت‌گذاری به‌عنوان خوانده‌شده" : undefined}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            unread ? "bg-primary" : "bg-transparent"
                          )}
                          aria-hidden="true"
                        />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm",
                            unread ? "font-semibold" : "text-muted-foreground"
                          )}
                        >
                          {n.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/80">
                          {faRelativeTime(n.createdAt)}
                        </span>
                      </span>
                      {n.body ? (
                        <span className="line-clamp-2 ps-4 text-xs leading-5 text-muted-foreground">
                          {n.body}
                        </span>
                      ) : null}
                      {n.ticketNumber !== null ? (
                        <span className="ps-4">
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            <span dir="ltr" className="font-mono text-[10px]">
                              #{faNum(n.ticketNumber)}
                            </span>
                          </Badge>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
