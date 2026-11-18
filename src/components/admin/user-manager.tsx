"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleUserRound,
  Clock3,
  KeyRound,
  Loader2,
  Lock,
  PauseCircle,
  PlayCircle,
  Plus,
  ScrollText,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import { PERMISSION_CATALOG, PERMISSION_CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/rbac/permissions";
import { UserCreateDialog } from "@/components/admin/user-create-dialog";
import { UserEditDialog } from "@/components/admin/user-edit-dialog";
import { UserMembershipsDialog } from "@/components/admin/user-memberships-dialog";
import { UserOverridesDialog } from "@/components/admin/user-overrides-dialog";
import { UserActivityDialog } from "@/components/admin/user-activity-dialog";
import { UserResetPasswordDialog } from "@/components/admin/user-reset-password-dialog";
import { faDateTimeFormat, faNum } from "@/lib/format";

export type ManagedUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roleKey: string;
  roleName: string;
  status: string;
  isAvailable: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  activeSessions: number;
  memberships: { departmentId: string; departmentName: string; isManager: boolean }[];
};

export type RoleRef = { key: string; name: string; isSystem: boolean };
export type DepartmentRef = { id: string; name: string; isActive: boolean };

export type UsersPayload = {
  users: ManagedUser[];
  roles: RoleRef[];
  departments: DepartmentRef[];
  roleBindings: Record<string, string[]>;
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "فعال", className: "text-emerald-700 border-emerald-200" },
  INACTIVE: { label: "غیرفعال", className: "text-muted-foreground" },
  SUSPENDED: { label: "معلق", className: "text-destructive border-destructive/30" },
};

export function UserManager({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const [payload, setPayload] = useState<UsersPayload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [membershipUser, setMembershipUser] = useState<ManagedUser | null>(null);
  const [overridesUser, setOverridesUser] = useState<ManagedUser | null>(null);
  const [activityUser, setActivityUser] = useState<ManagedUser | null>(null);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);

  const reload = useCallback(async () => {
    const res = await apiFetch<UsersPayload>("/api/admin/users");
    if (res.ok) setPayload(res.data);
    else {
      setPayload({ users: [], roles: [], departments: [], roleBindings: {} });
      toast({ title: "خطا در دریافت کاربران", description: res.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch<UsersPayload>("/api/admin/users");
      if (cancelled) return;
      if (res.ok) setPayload(res.data);
      else {
        setPayload({ users: [], roles: [], departments: [], roleBindings: {} });
        toast({ title: "خطا در دریافت کاربران", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  async function patchUser(u: ManagedUser, data: Record<string, unknown>, successTitle: string) {
    setBusyId(u.id);
    const res = await apiFetch(`/api/admin/users/${u.id}`, apiJson("PATCH", data));
    setBusyId(null);
    if (!res.ok) {
      toast({ title: "به‌روزرسانی ناموفق بود", description: res.error, variant: "destructive" });
      return false;
    }
    toast({ title: successTitle });
    void reload();
    return true;
  }

  if (payload === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  const { users, roles, departments } = payload;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {faNum(users.length)} حساب کاربری — وضعیت، نقش، دسترسی دپارتمان و فعالیت
        </p>
        <Button onClick={() => setCreateOpen(true)} disabled={!canManage}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          حساب جدید
        </Button>
      </div>

      {users.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            هنوز حسابی ثبت نشده است.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {users.map((u) => {
            const status = STATUS_LABELS[u.status] ?? { label: u.status, className: "" };
            const isSelf = false; // server rejects self-demotion anyway
            return (
              <li key={u.id}>
                <Card className={u.status === "ACTIVE" ? "" : "opacity-80"}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold">
                          {u.name.trim().charAt(0) || "ک"}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{u.name}</h3>
                            <span dir="ltr" className="text-xs text-muted-foreground">
                              @{u.username}
                            </span>
                            <Badge variant="outline" className={status.className}>
                              {status.label}
                            </Badge>
                            <Badge variant="secondary">{u.roleName}</Badge>
                            {u.mustChangePassword ? (
                              <Badge variant="outline" className="gap-1 text-amber-700 border-amber-200">
                                <KeyRound className="h-3 w-3" aria-hidden="true" />
                                تغییر رمز لازم
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3 w-3" aria-hidden="true" />
                              آخرین ورود: {u.lastLoginAt ? faDateTimeFormat(u.lastLoginAt) : "—"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                              نشست فعال: {faNum(u.activeSessions)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <UsersRound className="h-3 w-3" aria-hidden="true" />
                              {u.memberships.length > 0
                                ? u.memberships
                                    .map((m) => `${m.departmentName}${m.isManager ? " (مدیر)" : ""}`)
                                    .join("، ")
                                : "بدون دپارتمان"}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 lg:items-end">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            checked={u.isAvailable}
                            disabled={!canManage || busyId === u.id}
                            onCheckedChange={(v) => patchUser(u, { isAvailable: v }, "وضعیت در دسترس بودن تغییر کرد")}
                            aria-label={`در دسترس بودن ${u.name}`}
                          />
                          در دسترس برای ارجاع
                        </label>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {u.status === "ACTIVE" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive"
                              disabled={!canManage || busyId === u.id}
                              onClick={() => patchUser(u, { status: "SUSPENDED" }, "حساب معلق شد")}
                            >
                              <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              تعلیق
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-emerald-700 hover:text-emerald-700"
                              disabled={!canManage || busyId === u.id}
                              onClick={() => patchUser(u, { status: "ACTIVE" }, "حساب فعال شد")}
                            >
                              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              فعال‌سازی
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={!canManage}
                            onClick={() => setEditUser(u)}
                          >
                            <UserRoundCog className="h-3.5 w-3.5" aria-hidden="true" />
                            ویرایش
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={!canManage}
                            onClick={() => setMembershipUser(u)}
                          >
                            <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
                            دپارتمان‌ها
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={!canManage}
                            onClick={() => setResetUser(u)}
                          >
                            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                            بازنشانی رمز
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={!canManage}
                            onClick={() => setOverridesUser(u)}
                          >
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            استثناها
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={!canManage || busyId === u.id}
                            onClick={() => setActivityUser(u)}
                          >
                            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                            فعالیت
                          </Button>
                          {busyId === u.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* dialogs */}
      <UserCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={roles}
        onCreated={() => reload()}
      />
      <UserEditDialog
        key={`edit-${editUser?.id ?? "none"}`}
        user={editUser}
        roles={roles}
        onClose={() => setEditUser(null)}
        onSaved={() => {
          setEditUser(null);
          void reload();
        }}
      />
      <UserMembershipsDialog
        key={`memberships-${membershipUser?.id ?? "none"}`}
        user={membershipUser}
        departments={departments}
        onClose={() => setMembershipUser(null)}
        onSaved={() => {
          setMembershipUser(null);
          void reload();
        }}
      />
      <UserOverridesDialog
        user={overridesUser}
        roleBindings={payload.roleBindings}
        onClose={() => setOverridesUser(null)}
        onSaved={() => {
          setOverridesUser(null);
          void reload();
        }}
      />
      <UserResetPasswordDialog
        user={resetUser}
        onClose={() => setResetUser(null)}
      />
      <UserActivityDialog
        key={`activity-${activityUser?.id ?? "none"}`}
        userId={activityUser?.id ?? null}
        userName={activityUser?.name ?? ""}
        onClose={() => setActivityUser(null)}
      />

      {/* catalog summary footnote */}
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <CircleUserRound className="h-3.5 w-3.5" aria-hidden="true" />
        کنترل دسترسی پیش‌فرض‌ممنوع است؛ استثناهای کاربر بر مجوزهای نقش اولویت دارند.
        <Separator orientation="vertical" className="h-3" />
        {faNum(PERMISSION_CATALOG.length)} مجوز در {faNum(CATEGORY_ORDER.length)} دسته
      </div>
    </div>
  );
}
