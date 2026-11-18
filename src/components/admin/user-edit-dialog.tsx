"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import type { ManagedUser, RoleRef } from "@/components/admin/user-manager";

export function UserEditDialog({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null;
  roles: RoleRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  // State initializes from props; the parent remounts this dialog with a key
  // per user so opening a different account always starts from fresh values.
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [roleKey, setRoleKey] = useState(user?.roleKey ?? roles[0]?.key ?? "");
  const [isAvailable, setIsAvailable] = useState(user?.isAvailable ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    const res = await apiFetch(
      `/api/admin/users/${user.id}`,
      apiJson("PATCH", {
        name,
        email: email.trim() === "" ? null : email,
        roleKey,
        isAvailable,
      })
    );
    setSaving(false);

    if (!res.ok) {
      toast({ title: "ذخیره ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "اطلاعات حساب به‌روزرسانی شد" });
    onSaved();
  }

  return (
    <Dialog open={user !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ویرایش حساب — {user?.name}</DialogTitle>
          <DialogDescription dir="ltr" className="text-right">
            @{user?.username}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="edit-name">نام و نام خانوادگی</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-email">ایمیل</Label>
            <Input
              id="edit-email"
              dir="ltr"
              className="text-left"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>نقش</Label>
            <Select value={roleKey} onValueChange={setRoleKey}>
              <SelectTrigger aria-label="انتخاب نقش">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.name} {r.isSystem ? "" : "(سفارشی)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              تغییر نقش، مجوزهای مؤثر حساب را فوراً تغییر می‌دهد.
            </p>
          </div>

          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            در دسترس برای ارجاع تیکت
            <Switch checked={isAvailable} onCheckedChange={setIsAvailable} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            ذخیره
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
