"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import type { ManagedUser } from "@/components/admin/user-manager";

export function UserResetPasswordDialog({
  user,
  onClose,
}: {
  user: ManagedUser | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function resetLocalState() {
    setMode("generate");
    setPassword("");
    setIssued(null);
    setCopied(false);
  }

  async function handleReset() {
    if (!user) return;
    setSaving(true);
    const res = await apiFetch<{ temporaryPassword: string }>(
      `/api/admin/users/${user.id}/reset-password`,
      apiJson("POST", {
        generate: mode === "generate",
        password: mode === "manual" ? password : undefined,
      })
    );
    setSaving(false);

    if (!res.ok) {
      toast({ title: "بازنشانی ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setIssued(res.data.temporaryPassword);
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          resetLocalState();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            بازنشانی رمز عبور — {user?.name}
          </DialogTitle>
          <DialogDescription dir="ltr" className="text-right">
            @{user?.username}
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-4 py-1">
            <Alert>
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                این رمز فقط یک‌بار نمایش داده می‌شود و در هیچ‌جا ذخیره نمی‌شود. همه نشست‌های فعال این حساب باطل شده‌اند و کاربر در ورود بعدی باید رمز را تغییر دهد.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="flex-1 rounded-lg border bg-muted/50 px-3 py-2 text-left text-sm font-semibold tracking-wide select-all">
                {issued}
              </code>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={copy} aria-label="کپی رمز">
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "generate" | "manual")}>
              <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="generate" id="pw-generate" />
                تولید رمز امن تصادفی توسط سامانه
              </label>
              <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="manual" id="pw-manual" className="mt-0.5" />
                <span className="flex-1 space-y-2">
                  ورود دستی رمز
                  <Input
                    dir="ltr"
                    className="text-left"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min12CharsUpper1Lower1"
                    disabled={mode !== "manual"}
                    autoComplete="off"
                  />
                  <span className="block text-xs text-muted-foreground">
                    حداقل ۱۲ کاراکتر با حروف کوچک و بزرگ لاتین و عدد.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          {issued ? (
            <Button
              onClick={() => {
                onClose();
                resetLocalState();
              }}
            >
              متوجه شدم
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  resetLocalState();
                }}
                disabled={saving}
              >
                انصراف
              </Button>
              <Button onClick={handleReset} disabled={saving || (mode === "manual" && password.length === 0)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                بازنشانی و ابطال نشست‌ها
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
