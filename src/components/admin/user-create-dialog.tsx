"use client";

import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { RoleRef } from "@/components/admin/user-manager";

export function UserCreateDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roles: RoleRef[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleKey, setRoleKey] = useState<string>("OPERATOR");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    setSaving(true);
    const res = await apiFetch(
      "/api/admin/users",
      apiJson("POST", { username, name, email, password, roleKey })
    );
    setSaving(false);

    if (!res.ok) {
      toast({ title: "ایجاد حساب ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "حساب کاربری ایجاد شد", description: `@${username}` });
    setUsername("");
    setName("");
    setEmail("");
    setPassword("");
    setRoleKey("OPERATOR");
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            ایجاد حساب کاربری
          </DialogTitle>
          <DialogDescription>
            رمز عبور باید حداقل ۱۲ کاراکتر شامل حروف کوچک و بزرگ لاتین و عدد باشد.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new-username">نام کاربری</Label>
              <Input
                id="new-username"
                dir="ltr"
                className="text-left"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="operator1"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-name">نام و نام خانوادگی</Label>
              <Input
                id="new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="نام اپراتور"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-email">ایمیل (اختیاری)</Label>
            <Input
              id="new-email"
              dir="ltr"
              className="text-left"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@org.ir"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">رمز عبور اولیه</Label>
            <Input
              id="new-password"
              dir="ltr"
              className="text-left"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            ایجاد حساب
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
