"use client";

import { useEffect, useState } from "react";
import { Loader2, Star, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import type { DepartmentRef, ManagedUser } from "@/components/admin/user-manager";

type MembershipDraft = { departmentId: string; isManager: boolean };

export function UserMembershipsDialog({
  user,
  departments,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null;
  departments: DepartmentRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  // Draft initializes from props; the parent remounts this dialog with a key
  // per user so each open starts from the server state.
  const [draft, setDraft] = useState<MembershipDraft[]>(
    () =>
      user?.memberships.map((m) => ({
        departmentId: m.departmentId,
        isManager: m.isManager,
      })) ?? []
  );
  const [saving, setSaving] = useState(false);

  function toggle(departmentId: string, checked: boolean) {
    setDraft((prev) =>
      checked
        ? [...prev, { departmentId, isManager: false }]
        : prev.filter((m) => m.departmentId !== departmentId)
    );
  }

  function setManager(departmentId: string, isManager: boolean) {
    setDraft((prev) =>
      prev.map((m) => (m.departmentId === departmentId ? { ...m, isManager } : m))
    );
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    const res = await apiFetch(
      `/api/admin/users/${user.id}/memberships`,
      apiJson("PUT", { memberships: draft })
    );
    setSaving(false);

    if (!res.ok) {
      toast({ title: "ذخیره ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "دپارتمان‌های کاربر ذخیره شد" });
    onSaved();
  }

  return (
    <Dialog open={user !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersRound className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            دپارتمان‌های {user?.name}
          </DialogTitle>
          <DialogDescription>
            عضویت در دپارتمان، «دامنه» کاری کاربر را تعیین می‌کند؛ پرچم «مدیر» مسئولیت دپارتمان را نشان می‌دهد.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto scroll-slim rounded-lg border">
          <ul className="divide-y">
            {departments.map((d) => {
              const current = draft.find((m) => m.departmentId === d.id);
              return (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    id={`m-${d.id}`}
                    checked={current !== undefined}
                    onCheckedChange={(v) => toggle(d.id, v === true)}
                    disabled={saving}
                    aria-label={`عضویت در ${d.name}`}
                  />
                  <Label
                    htmlFor={`m-${d.id}`}
                    className="flex-1 cursor-pointer text-sm font-normal"
                  >
                    {d.name}
                    {!d.isActive ? (
                      <Badge variant="outline" className="ms-2 text-[10px] text-muted-foreground">
                        غیرفعال
                      </Badge>
                    ) : null}
                  </Label>
                  {current ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={current.isManager}
                        onCheckedChange={(v) => setManager(d.id, v)}
                        disabled={saving}
                        aria-label={`مدیر بودن در ${d.name}`}
                      />
                      <span className={current.isManager ? "text-amber-700" : ""}>
                        {current.isManager ? (
                          <>
                            <Star className="mb-0.5 inline h-3 w-3" aria-hidden="true" /> مدیر
                          </>
                        ) : (
                          "عضو"
                        )}
                      </span>
                    </label>
                  ) : null}
                </li>
              );
            })}
            {departments.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                هنوز دپارتمانی ثبت نشده است.
              </li>
            ) : null}
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            ذخیره عضویت‌ها
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
