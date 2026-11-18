"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  CATEGORY_ORDER,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORY_LABELS,
} from "@/lib/rbac/permissions";
import { faNum } from "@/lib/format";
import type { ManagedUser } from "@/components/admin/user-manager";

type OverrideDraft = { permissionKey: string; effect: "ALLOW" | "DENY"; note?: string | null };
type Mode = "inherit" | "ALLOW" | "DENY";

export function UserOverridesDialog({
  user,
  roleBindings,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null;
  roleBindings: Record<string, string[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, Mode>>({});
  const [saving, setSaving] = useState(false);

  // user overrides currently stored server-side → fetch lazily via reload payload
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ overrides: OverrideDraft[] }>(
        `/api/admin/users/${user.id}/overrides`
      );
      if (cancelled) return;
      if (res.ok) {
        const map: Record<string, Mode> = {};
        for (const o of res.data.overrides) map[o.permissionKey] = o.effect;
        setDraft(map);
      } else {
        setDraft({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: PERMISSION_CATEGORY_LABELS[cat],
      items: PERMISSION_CATALOG.filter((p) => p.category === cat),
    }));
  }, []);

  const roleGrants = useMemo(
    () => new Set(roleBindings[user?.roleKey ?? ""] ?? []),
    [roleBindings, user]
  );

  function setMode(key: string, mode: Mode) {
    setDraft((prev) => ({ ...prev, [key]: mode }));
  }

  async function handleSave() {
    if (!user) return;
    const overrides: OverrideDraft[] = Object.entries(draft)
      .filter(([, mode]) => mode !== "inherit")
      .map(([permissionKey, effect]) => ({ permissionKey, effect: effect as "ALLOW" | "DENY" }));

    setSaving(true);
    const res = await apiFetch(
      `/api/admin/users/${user.id}/overrides`,
      apiJson("PUT", { overrides })
    );
    setSaving(false);

    if (!res.ok) {
      toast({ title: "ذخیره ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "استثناهای کاربر ذخیره شد",
      description: "تغییرات بلافاصله روی دسترسی مؤثر اعمال می‌شود.",
    });
    onSaved();
  }

  return (
    <Dialog open={user !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            استثناهای مجوز — {user?.name}
          </DialogTitle>
          <DialogDescription>
            حالت «ارث از نقش» یعنی فقط مجوزهای نقش اعمال شود؛ «مجاز» نقشِ فاقد را جبران می‌کند و «رد» حتی مجوز نقش را هم می‌بندد.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border p-3 space-y-4">
          {grouped.map((g) => (
            <section key={g.category}>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                {g.label} <span className="font-normal">({faNum(g.items.length)} مجوز)</span>
              </h4>
              <ul className="space-y-1.5">
                {g.items.map((p) => {
                  const mode = draft[p.key] ?? "inherit";
                  const roleGranted = roleGrants.has(p.key);
                  return (
                    <li
                      key={p.key}
                      className="flex flex-col gap-1.5 rounded-lg border px-3 py-2 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-5">{p.description}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <code dir="ltr">{p.key}</code>
                          <Badge
                            variant="outline"
                            className={
                              roleGranted
                                ? "text-emerald-700 border-emerald-200"
                                : "text-muted-foreground"
                            }
                          >
                            {roleGranted ? "نقش: دارد" : "نقش: ندارد"}
                          </Badge>
                        </p>
                      </div>
                      <Select
                        value={mode}
                        onValueChange={(v) => setMode(p.key, v as Mode)}
                        disabled={saving}
                      >
                        <SelectTrigger className="h-8 w-32 shrink-0 text-xs" aria-label={`حالت مجوز ${p.key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">ارث از نقش</SelectItem>
                          <SelectItem value="ALLOW">مجاز (ALLOW)</SelectItem>
                          <SelectItem value="DENY">رد (DENY)</SelectItem>
                        </SelectContent>
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            ذخیره استثناها
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
