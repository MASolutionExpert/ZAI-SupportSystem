"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ChangePasswordForm({ mustChange }: { mustChange: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmNewPassword) {
      setError("تکرار رمز عبور با رمز جدید یکسان نیست.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "تغییر رمز عبور ناموفق بود.");
        setSubmitting(false);
        return;
      }

      setDone(true);
      // Give the user a moment to read the confirmation, then continue.
      setTimeout(() => {
        router.replace("/admin");
        router.refresh();
      }, 1200);
    } catch {
      setError("ارتباط با سرور برقرار نشد. اتصال خود را بررسی کنید.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden="true" />
          <p className="font-semibold">رمز عبور با موفقیت تغییر کرد</p>
          <p className="text-sm text-muted-foreground">در حال انتقال به داشبورد…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">تنظیم رمز عبور جدید</CardTitle>
        <CardDescription className="text-xs leading-5">
          حداقل ۱۲ کاراکتر، شامل حروف کوچک و بزرگ لاتین و عدد. سایر نشست‌های فعال پس از تغییر، خارج می‌شوند.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="currentPassword">رمز عبور فعلی</Label>
            <Input
              id="currentPassword"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="text-left"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">رمز عبور جدید</Label>
            <Input
              id="newPassword"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="text-left"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmNewPassword">تکرار رمز عبور جدید</Label>
            <Input
              id="confirmNewPassword"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              className="text-left"
            />
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                در حال ثبت…
              </>
            ) : (
              "ثبت رمز عبور جدید"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
