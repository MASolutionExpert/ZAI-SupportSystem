"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson } from "@/lib/client/api";
import {
  CATEGORY_ORDER,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORY_LABELS,
} from "@/lib/rbac/permissions";
import { faNum } from "@/lib/format";

type ManagedRole = {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionKeys: string[];
};

type RolesPayload = { roles: ManagedRole[] };

export function RoleManager({
  canManageRoles,
  canManagePermissions,
}: {
  canManageRoles: boolean;
  canManagePermissions: boolean;
}) {
  const { toast } = useToast();
  const [payload, setPayload] = useState<RolesPayload | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ key: "", name: "", description: "" });
  const [savingRole, setSavingRole] = useState(false);
  const [bindingsRole, setBindingsRole] = useState<ManagedRole | null>(null);
  const [draftKeys, setDraftKeys] = useState<Set<string>>(new Set());
  const [savingBindings, setSavingBindings] = useState(false);
  const [editRole, setEditRole] = useState<ManagedRole | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    const res = await apiFetch<RolesPayload>("/api/admin/roles");
    if (res.ok) setPayload(res.data);
    else {
      setPayload({ roles: [] });
      toast({ title: "خطا در دریافت نقش‌ها", description: res.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch<RolesPayload>("/api/admin/roles");
      if (cancelled) return;
      if (res.ok) setPayload(res.data);
      else {
        setPayload({ roles: [] });
        toast({ title: "خطا در دریافت نقش‌ها", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        category: cat,
        label: PERMISSION_CATEGORY_LABELS[cat],
        items: PERMISSION_CATALOG.filter((p) => p.category === cat),
      })),
    []
  );

  async function handleCreate() {
    setSavingRole(true);
    const res = await apiFetch(
      "/api/admin/roles",
      apiJson("POST", {
        key: form.key.trim().toUpperCase(),
        name: form.name,
        description: form.description.trim() || null,
      })
    );
    setSavingRole(false);

    if (!res.ok) {
      toast({ title: "ایجاد نقش ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "نقش سفارشی ایجاد شد",
      description: "حالا مجوزهای نقش را از دکمه «مجوزها» تنظیم کنید.",
    });
    setForm({ key: "", name: "", description: "" });
    setCreateOpen(false);
    void reload();
  }

  function openBindings(role: ManagedRole) {
    setBindingsRole(role);
    setDraftKeys(new Set(role.permissionKeys));
  }

  async function handleSaveBindings() {
    if (!bindingsRole) return;
    setSavingBindings(true);
    const res = await apiFetch(
      `/api/admin/roles/${encodeURIComponent(bindingsRole.key)}/bindings`,
      apiJson("PUT", { permissionKeys: [...draftKeys] })
    );
    setSavingBindings(false);

    if (!res.ok) {
      toast({ title: "ذخیره ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "مجوزهای نقش ذخیره شد",
      description: "دسترسی مؤثر همه کاربران این نقش به‌روزرسانی شد.",
    });
    setBindingsRole(null);
    void reload();
  }

  async function handleEditSave() {
    if (!editRole) return;
    setSavingEdit(true);
    const res = await apiFetch(
      `/api/admin/roles/${encodeURIComponent(editRole.key)}`,
      apiJson("PATCH", {
        name: editForm.name,
        description: editForm.description.trim() || null,
      })
    );
    setSavingEdit(false);

    if (!res.ok) {
      toast({ title: "ذخیره ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "نقش ویرایش شد" });
    setEditRole(null);
    void reload();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await apiFetch(`/api/admin/roles/${encodeURIComponent(deleteTarget.key)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    setDeleting(false);
    setDeleteTarget(null);

    if (!res.ok) {
      toast({ title: "حذف ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "نقش حذف شد" });
    void reload();
  }

  if (payload === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          نقش‌های سیستمی و سفارشی — مجوزهای «مدیر ارشد» همیشه کامل و قفل است.
        </p>
        <Button onClick={() => setCreateOpen(true)} disabled={!canManageRoles}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          نقش سفارشی
        </Button>
      </div>

      <ul className="space-y-3">
        {payload.roles.map((role) => (
          <li key={role.key}>
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                    {role.isSystem ? (
                      <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <UsersRound className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{role.name}</h3>
                      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {role.key}
                      </code>
                      <Badge variant={role.isSystem ? "secondary" : "outline"}>
                        {role.isSystem ? "سیستمی" : "سفارشی"}
                      </Badge>
                    </div>
                    {role.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                    ) : null}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {faNum(role.userCount)} کاربر — {faNum(role.permissionKeys.length)} مجوز از {faNum(PERMISSION_CATALOG.length)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!canManagePermissions || role.key === "SUPER_ADMIN"}
                    onClick={() => openBindings(role)}
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    مجوزها
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!canManageRoles || role.isSystem}
                    onClick={() => {
                      setEditRole(role);
                      setEditForm({ name: role.name, description: role.description ?? "" });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    ویرایش
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-destructive hover:text-destructive"
                    disabled={!canManageRoles || role.isSystem || role.userCount > 0}
                    onClick={() => setDeleteTarget(role)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    حذف
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {/* create custom role */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>نقش سفارشی جدید</DialogTitle>
            <DialogDescription>
              کلید نقش بعداً قابل تغییر نیست؛ مجوزها پس از ایجاد از دکمه «مجوزها» تنظیم می‌شوند.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="role-key">کلید نقش</Label>
                <Input
                  id="role-key"
                  dir="ltr"
                  className="text-left"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })}
                  placeholder="SALES_AGENT"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-name">نام نمایشی</Label>
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="کارشناس فروش"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">توضیح</Label>
              <Textarea
                id="role-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="شرح مأموریت این نقش"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={savingRole}>
              انصراف
            </Button>
            <Button onClick={handleCreate} disabled={savingRole}>
              {savingRole ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              ایجاد نقش
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* bindings editor */}
      <Dialog open={bindingsRole !== null} onOpenChange={(v) => !v && setBindingsRole(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              مجوزهای نقش — {bindingsRole?.name}
            </DialogTitle>
            <DialogDescription>
              {bindingsRole?.key === "SUPER_ADMIN"
                ? "مجوزهای مدیر ارشد همیشه کامل است و قابل تغییر نیست."
                : "مجوزها را فعال/غیرفعال کنید؛ تغییرات فوراً برای همه کاربران این نقش اعمال می‌شود."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border p-3 space-y-4">
            {grouped.map((g) => {
              const allChecked = g.items.every((p) => draftKeys.has(p.key));
              return (
                <section key={g.category}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-muted-foreground">
                      {g.label} ({faNum(g.items.length)})
                    </h4>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => {
                        setDraftKeys((prev) => {
                          const next = new Set(prev);
                          for (const p of g.items) {
                            if (allChecked) next.delete(p.key);
                            else next.add(p.key);
                          }
                          return next;
                        });
                      }}
                    >
                      {allChecked ? "حذف همه این دسته" : "افزودن همه این دسته"}
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {g.items.map((p) => (
                      <li key={p.key} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                        <Checkbox
                          id={`perm-${p.key}`}
                          checked={draftKeys.has(p.key)}
                          onCheckedChange={(v) =>
                            setDraftKeys((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(p.key);
                              else next.delete(p.key);
                              return next;
                            })
                          }
                          disabled={savingBindings}
                          aria-label={p.description}
                        />
                        <Label htmlFor={`perm-${p.key}`} className="flex-1 cursor-pointer text-sm font-normal">
                          {p.description}
                          <code dir="ltr" className="ms-2 text-[10px] text-muted-foreground">
                            {p.key}
                          </code>
                        </Label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindingsRole(null)} disabled={savingBindings}>
              انصراف
            </Button>
            <Button onClick={handleSaveBindings} disabled={savingBindings}>
              {savingBindings ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              ذخیره مجوزها
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit custom role */}
      <Dialog open={editRole !== null} onOpenChange={(v) => !v && setEditRole(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ویرایش نقش — {editRole?.name}</DialogTitle>
            <DialogDescription dir="ltr" className="text-right">
              {editRole?.key}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="edit-role-name">نام نمایشی</Label>
              <Input
                id="edit-role-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role-desc">توضیح</Label>
              <Textarea
                id="edit-role-desc"
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRole(null)} disabled={savingEdit}>
              انصراف
            </Button>
            <Button onClick={handleEditSave} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نقش سفارشی</AlertDialogTitle>
            <AlertDialogDescription>
              نقش «{deleteTarget?.name}» و تمام اتصال‌های مجوز آن حذف می‌شود. این عمل در گزارش حسابرسی ثبت خواهد شد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
