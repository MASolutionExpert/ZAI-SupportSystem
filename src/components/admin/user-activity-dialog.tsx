"use client";

import { useEffect, useState } from "react";
import { Clock3, ScrollText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/client/api";
import { faDateTimeFormat, faNum } from "@/lib/format";
import type { ManagedUser } from "@/components/admin/user-manager";

type ActivityPayload = {
  user: ManagedUser;
  recentAudits: {
    id: string;
    action: string;
    createdAt: string;
    entityType: string | null;
    entityId: string | null;
  }[];
};

export function UserActivityDialog({
  userId,
  userName,
  onClose,
}: {
  userId: string | null;
  userName: string;
  onClose: () => void;
}) {
  // The parent remounts this dialog with a key per user; loading starts true
  // only when a user is actually selected.
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [loading, setLoading] = useState(userId !== null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<ActivityPayload>(`/api/admin/users/${userId}/activity`);
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setData(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <Dialog open={userId !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            فعالیت و بار کاری — {userName}
          </DialogTitle>
          <DialogDescription>
            آماره‌های واقعی نشست و آخرین رویدادهای حسابرسی این حساب.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  آخرین ورود
                </p>
                <p className="mt-1 text-sm">
                  {data.user.lastLoginAt ? faDateTimeFormat(data.user.lastLoginAt) : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  نشست‌های فعال
                </p>
                <p className="mt-1 text-sm">{faNum(data.user.activeSessions)}</p>
              </div>
            </div>

            <div className="rounded-lg border p-3 text-sm">
              <p className="text-xs text-muted-foreground">دپارتمان‌ها</p>
              <p className="mt-1">
                {data.user.memberships.length > 0
                  ? data.user.memberships
                      .map((m) => `${m.departmentName}${m.isManager ? " (مدیر)" : ""}`)
                      .join("، ")
                  : "بدون عضویت"}
              </p>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground">وضعیت ارجاع</p>
              <p className="mt-1">
                {data.user.status === "ACTIVE" && data.user.isAvailable
                  ? "در دسترس برای ارجاع تیکت"
                  : data.user.status !== "ACTIVE"
                    ? "حساب غیرفعال — ارجاع نمی‌شود"
                    : "در دسترس نیست"}
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                آخرین رویدادهای حسابرسی
              </p>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto scroll-slim rounded-lg border p-3">
                {data.recentAudits.length === 0 ? (
                  <li className="text-xs text-muted-foreground">رویدادی ثبت نشده است.</li>
                ) : (
                  data.recentAudits.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                      <Badge variant="outline" className="shrink-0 font-normal" dir="ltr">
                        {a.action}
                      </Badge>
                      <span className="text-muted-foreground">{faDateTimeFormat(a.createdAt)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            اطلاعات فعالیت در دسترس نیست.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
