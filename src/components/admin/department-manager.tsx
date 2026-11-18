"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  DEPARTMENT_ICON_KEYS,
  DEPARTMENT_ICON_MAP,
} from "@/lib/department-icons";

export type ManagedDepartment = {
  id: string;
  name: string;
  description: string | null;
  iconKey: string;
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
  aiEnabled: boolean;
  welcomeMessage: string | null;
  memberCount: number;
  managerCount: number;
};

type FormState = {
  name: string;
  description: string;
  iconKey: string;
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
  aiEnabled: boolean;
  welcomeMessage: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  iconKey: "MessageCircle",
  displayOrder: 0,
  isActive: true,
  isPublic: true,
  aiEnabled: false,
  welcomeMessage: "",
};

function toPayload(form: FormState) {
  return {
    name: form.name,
    description: form.description.trim() || null,
    iconKey: form.iconKey,
    displayOrder: form.displayOrder,
    isActive: form.isActive,
    isPublic: form.isPublic,
    aiEnabled: form.aiEnabled,
    welcomeMessage: form.welcomeMessage.trim() || null,
  };
}

export function DepartmentManager({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const [departments, setDepartments] = useState<ManagedDepartment[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedDepartment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    const res = await apiFetch<{ departments: ManagedDepartment[] }>(
      "/api/admin/departments"
    );
    if (res.ok) setDepartments(res.data.departments);
    else {
      setDepartments([]);
      toast({ title: "خطا در دریافت دپارتمان‌ها", description: res.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ departments: ManagedDepartment[] }>(
        "/api/admin/departments"
      );
      if (cancelled) return;
      if (res.ok) setDepartments(res.data.departments);
      else {
        setDepartments([]);
        toast({ title: "خطا در دریافت دپارتمان‌ها", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  const nextOrder = useMemo(
    () =>
      (departments?.reduce((max, d) => Math.max(max, d.displayOrder), 0) ?? 0) + 1,
    [departments]
  );

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, displayOrder: nextOrder });
    setDialogOpen(true);
  }

  function openEdit(d: ManagedDepartment) {
    setEditingId(d.id);
    setForm({
      name: d.name,
      description: d.description ?? "",
      iconKey: d.iconKey,
      displayOrder: d.displayOrder,
      isActive: d.isActive,
      isPublic: d.isPublic,
      aiEnabled: d.aiEnabled,
      welcomeMessage: d.welcomeMessage ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (form.name.trim().length < 2) {
      toast({ title: "نام دپارتمان حداقل ۲ کاراکتر است.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = toPayload(form);
    const res = editingId
      ? await apiFetch(`/api/admin/departments/${editingId}`, apiJson("PATCH", payload))
      : await apiFetch("/api/admin/departments", apiJson("POST", payload));
    setSaving(false);

    if (!res.ok) {
      toast({ title: "ذخیره ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: editingId ? "دپارتمان ویرایش شد" : "دپارتمان ایجاد شد",
      description: "تغییرات فوراً در صفحه عمومی سامانه اعمال می‌شود.",
    });
    setDialogOpen(false);
    void reload();
  }

  async function patchField(d: ManagedDepartment, field: Partial<ManagedDepartment>) {
    setBusyId(d.id);
    const res = await apiFetch(`/api/admin/departments/${d.id}`, apiJson("PATCH", field));
    setBusyId(null);
    if (!res.ok) {
      toast({ title: "به‌روزرسانی ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setDepartments((prev) =>
      prev
        ? prev.map((row) => (row.id === d.id ? { ...row, ...field } : row))
        : prev
    );
  }

  async function move(index: number, direction: -1 | 1) {
    if (!departments) return;
    const target = index + direction;
    if (target < 0 || target >= departments.length) return;

    const next = [...departments];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDepartments(next);

    const res = await apiFetch(
      "/api/admin/departments/reorder",
      apiJson("POST", { orderedIds: next.map((d) => d.id) })
    );
    if (!res.ok) {
      toast({ title: "ترتیب ذخیره نشد", description: res.error, variant: "destructive" });
      void reload();
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await apiFetch(`/api/admin/departments/${deleteTarget.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    setDeleting(false);
    setDeleteTarget(null);

    if (!res.ok) {
      toast({ title: "حذف ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "دپارتمان حذف شد" });
    void reload();
  }

  if (departments === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {departments.length === 0
            ? "هنوز دپارتمانی ثبت نشده است."
            : `${departments.length} دپارتمان — ترتیب نمایش با فلش‌ها تغییر می‌کند.`}
        </p>
        <Button onClick={openCreate} disabled={!canManage}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          دپارتمان جدید
        </Button>
      </div>

      {departments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">اولین دپارتمان را بسازید</p>
            <p className="text-xs text-muted-foreground max-w-md">
              دپارتمان‌های فعال و عمومی بلافاصله روی صفحه اصلی عمومی سامانه نمایش داده می‌شوند؛ بدون نیاز به استقرار مجدد.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {departments.map((d, index) => {
            const Icon = DEPARTMENT_ICON_MAP[d.iconKey] ?? MessageCircle;
            return (
              <li key={d.id}>
                <Card className={d.isActive ? "" : "opacity-70"}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{d.name}</h3>
                            <Badge
                              variant="outline"
                              className={
                                d.isActive
                                  ? "text-emerald-700 border-emerald-200"
                                  : "text-muted-foreground"
                              }
                            >
                              {d.isActive ? "فعال" : "غیرفعال"}
                            </Badge>
                            {d.aiEnabled ? (
                              <Badge variant="secondary" className="gap-1">
                                <Sparkles className="h-3 w-3" aria-hidden="true" />
                                دستیار فعال
                              </Badge>
                            ) : null}
                            {!d.isPublic ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                غیرعمومی
                              </Badge>
                            ) : null}
                          </div>
                          {d.description ? (
                            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                              {d.description}
                            </p>
                          ) : null}
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {d.memberCount} عضو ({d.managerCount} مدیر) — ترتیب: {d.displayOrder}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                        {/* visibility switches */}
                        <div className="flex items-center gap-4 rounded-lg border px-3 py-2">
                          <label className="flex items-center gap-2 text-xs">
                            <Switch
                              checked={d.isActive}
                              disabled={!canManage || busyId === d.id}
                              onCheckedChange={(v) => patchField(d, { isActive: v })}
                              aria-label={`فعال‌سازی ${d.name}`}
                            />
                            فعال
                          </label>
                          <Separator orientation="vertical" className="h-4" />
                          <label className="flex items-center gap-2 text-xs">
                            <Switch
                              checked={d.isPublic}
                              disabled={!canManage || busyId === d.id}
                              onCheckedChange={(v) => patchField(d, { isPublic: v })}
                              aria-label={`نمایش عمومی ${d.name}`}
                            />
                            {d.isPublic ? (
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            عمومی
                          </label>
                          <Separator orientation="vertical" className="h-4" />
                          <label className="flex items-center gap-2 text-xs">
                            <Switch
                              checked={d.aiEnabled}
                              disabled={!canManage || busyId === d.id}
                              onCheckedChange={(v) => patchField(d, { aiEnabled: v })}
                              aria-label={`دستیار هوشمند ${d.name}`}
                            />
                            AI
                          </label>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={index === 0 || !canManage}
                            onClick={() => move(index, -1)}
                            aria-label="انتقال به بالا"
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={index === departments.length - 1 || !canManage}
                            onClick={() => move(index, 1)}
                            aria-label="انتقال به پایین"
                          >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={!canManage}
                            onClick={() => openEdit(d)}
                            aria-label={`ویرایش ${d.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={!canManage || d.memberCount > 0}
                            onClick={() => setDeleteTarget(d)}
                            aria-label={`حذف ${d.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          {busyId === d.id ? (
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

      {/* create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "ویرایش دپارتمان" : "دپارتمان جدید"}</DialogTitle>
            <DialogDescription>
              فیلدها بلافاصله پس از ذخیره روی صفحه عمومی اعمال می‌شوند.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="dept-name">نام دپارتمان</Label>
              <Input
                id="dept-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثلاً دپارتمان مالی"
                maxLength={60}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dept-desc">توضیح کوتاه</Label>
              <Textarea
                id="dept-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="شرح وظایف و موضوعات پاسخگویی"
                rows={2}
                maxLength={300}
              />
            </div>

            <div className="space-y-2">
              <Label>آیکن</Label>
              <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="انتخاب آیکن">
                {DEPARTMENT_ICON_KEYS.map((key) => {
                  const Icon = DEPARTMENT_ICON_MAP[key]!;
                  const selected = form.iconKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm({ ...form, iconKey: key })}
                      className={[
                        "flex h-10 items-center justify-center rounded-lg border transition-colors",
                        selected
                          ? "border-primary bg-secondary text-primary"
                          : "text-muted-foreground hover:bg-muted",
                      ].join(" ")}
                    >
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                      <span className="sr-only">{key}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="dept-order">ترتیب نمایش</Label>
                <Input
                  id="dept-order"
                  dir="ltr"
                  type="number"
                  min={0}
                  max={9999}
                  value={form.displayOrder}
                  onChange={(e) =>
                    setForm({ ...form, displayOrder: Number(e.target.value) || 0 })
                  }
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dept-welcome">پیام خوش‌آمد (اختیاری)</Label>
                <Input
                  id="dept-welcome"
                  value={form.welcomeMessage}
                  onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
                  placeholder="نخستین پیام گفتگو"
                  maxLength={200}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
              <label className="flex items-center justify-between gap-2 text-sm">
                فعال
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                نمایش عمومی
                <Switch
                  checked={form.isPublic}
                  onCheckedChange={(v) => setForm({ ...form, isPublic: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                دستیار هوشمند
                <Switch
                  checked={form.aiEnabled}
                  onCheckedChange={(v) => setForm({ ...form, aiEnabled: v })}
                />
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف دپارتمان</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteTarget?.name}» برای همیشه حذف می‌شود. این عمل در گزارش حسابرسی ثبت خواهد شد.
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
