import {
  Activity,
  BarChart3,
  BookOpenText,
  BotMessageSquare,
  Building2,
  CheckCircle2,
  CircleUserRound,
  Database,
  HardDrive,
  KeyRound,
  LifeBuoy,
  ListChecks,
  FolderOpen,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Users,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { countActiveSessions } from "@/lib/auth/session";
import { getEffectivePermissions } from "@/lib/rbac/service";
import { PERMISSION_CATALOG } from "@/lib/rbac/permissions";
import { getAppVersion } from "@/lib/version";
import { checkDatabase } from "@/lib/db";
import { getStorageUsageBytes } from "@/lib/storage";
import { faBytes, faNum } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata = { title: "داشبورد" };

const processStartedAt = Date.now();

export default async function AdminDashboardPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const [version, dbOk, role, effective, activeSessions, users, departments, storageBytes, openTickets, auditRows] =
    await Promise.all([
      getAppVersion(),
      checkDatabase(),
      db.role.findUnique({ where: { key: user.roleKey } }),
      getEffectivePermissions(user.id),
      countActiveSessions().catch(() => -1),
      db.user.count().catch(() => -1),
      db.department.count().catch(() => -1),
      getStorageUsageBytes().catch(() => -1),
      db.ticket
        .count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } } })
        .catch(() => -1),
      db.auditLog.count().catch(() => -1),
    ]);

  const grantedCatalog = PERMISSION_CATALOG.filter((p) => effective.has(p.key));
  const uptimeMinutes = Math.max(1, Math.floor((Date.now() - processStartedAt) / 60_000));

  const has = (...keys: string[]) => keys.every((k) => effective.has(k));
  const hasAny = (...keys: string[]) => keys.some((k) => effective.has(k));

  const modules = [
    {
      label: "مدیریت دپارتمان‌ها",
      href: "/admin/departments",
      icon: <Building2 className="h-4.5 w-4.5" aria-hidden="true" />,
      show: has("admin.departments.manage"),
    },
    {
      label: "کاربران و اپراتورها",
      href: "/admin/users",
      icon: <UsersRound className="h-4.5 w-4.5" aria-hidden="true" />,
      show: has("admin.users.manage"),
    },
    {
      label: "نقش‌ها و مجوزها",
      href: "/admin/roles",
      icon: <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />,
      show: hasAny("admin.roles.manage", "admin.permissions.manage"),
    },
    {
      label: "مخزن دانش",
      href: "/admin/kb",
      icon: <BookOpenText className="h-4.5 w-4.5" aria-hidden="true" />,
      show: hasAny("kb.view", "kb.qa.create", "kb.collections.manage", "kb.documents.upload"),
    },
    {
      label: "تنظیمات هوش مصنوعی",
      href: "/admin/ai",
      icon: <BotMessageSquare className="h-4.5 w-4.5" aria-hidden="true" />,
      show: hasAny("ai.settings.access", "ai.provider.configure", "ai.department.settings.manage", "ai.usage.view"),
    },
    {
      label: "میز پشتیبانی",
      href: "/support",
      icon: <LifeBuoy className="h-4.5 w-4.5" aria-hidden="true" />,
      show: has("tickets.view"),
    },
    {
      label: "فایل‌های مشترک",
      href: "/files",
      icon: <FolderOpen className="h-4.5 w-4.5" aria-hidden="true" />,
      show: has("files.access"),
    },
    {
      label: "گزارش‌های مدیریتی",
      href: "/admin/reports",
      icon: <BarChart3 className="h-4.5 w-4.5" aria-hidden="true" />,
      show: hasAny("admin.reports.view", "ai.usage.view"),
    },
    {
      label: "گزارش حسابرسی",
      href: "/admin/audit",
      icon: <ScrollText className="h-4.5 w-4.5" aria-hidden="true" />,
      show: has("admin.audit.view"),
    },
    {
      label: "مدیریت ذخیره‌سازی",
      href: "/admin/storage",
      icon: <HardDrive className="h-4.5 w-4.5" aria-hidden="true" />,
      show: hasAny("admin.storage.manage", "files.quotas.manage"),
    },
    {
      label: "تنظیمات سامانه",
      href: "/admin/settings",
      icon: <Settings className="h-4.5 w-4.5" aria-hidden="true" />,
      show: has("admin.settings.manage"),
    },
    {
      label: "سلامت سامانه",
      href: "/admin/health",
      icon: <Activity className="h-4.5 w-4.5" aria-hidden="true" />,
      show: has("admin.dashboard.view"),
    },
  ].filter((m) => m.show);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Welcome */}
      <section className="sd-fade-up">
        <h1 className="text-xl sm:text-2xl font-bold">خوش آمدید، {user.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          وضعیت زیرساخت سامانه و دسترسی‌های واقعی حساب شما در این صفحه نمایش داده می‌شود.
        </p>
      </section>

      {/* Status cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              پایگاه داده
            </CardDescription>
            <CardTitle className="text-base flex items-center gap-2">
              {dbOk ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  متصل و سالم
                </>
              ) : (
                <>
                  <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
                  قطع — بررسی کنید
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            نسخه سامانه: <span dir="ltr">v{version}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Timer className="h-3.5 w-3.5" aria-hidden="true" />
              عمر پردازش
            </CardDescription>
            <CardTitle className="text-base">{faNum(uptimeMinutes)} دقیقه</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            از آخرین راه‌اندازی سرور
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              نشست‌های فعال
            </CardDescription>
            <CardTitle className="text-base">
              {activeSessions >= 0 ? faNum(activeSessions) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            حساب‌های واردشده در حال حاضر
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
              فضای ذخیره‌سازی
            </CardDescription>
            <CardTitle className="text-base">{faBytes(storageBytes)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            فایل‌های بارگذاری‌شده در مرکز فایل
          </CardContent>
        </Card>
      </section>

      {/* Identity & RBAC */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CircleUserRound className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
              حساب کاربری
            </CardTitle>
            <CardDescription className="text-xs">
              اطلاعات واقعی نشست جاری از پایگاه داده
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="shrink-0 text-muted-foreground">نام و نام کاربری</span>
              <span className="min-w-0 break-words text-left">
                {user.name}{" "}
                <span dir="ltr" className="text-muted-foreground">
                  (@{user.username})
                </span>
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="shrink-0 text-muted-foreground">نقش</span>
              <Badge variant="secondary" className="min-w-0 max-w-full break-words">
                {role?.name ?? user.roleKey}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="shrink-0 text-muted-foreground">وضعیت حساب</span>
              <Badge variant="outline" className="text-emerald-700 border-emerald-200">
                {user.status === "ACTIVE" ? "فعال" : user.status}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                تغییر رمز عبور
              </span>
              <span className="min-w-0 break-words text-left text-xs text-muted-foreground">
                از منوی کاربر در بالای صفحه
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
              مجوزهای مؤثر نقش شما
            </CardTitle>
            <CardDescription className="text-xs">
              {faNum(grantedCatalog.length)} مجوز از {faNum(PERMISSION_CATALOG.length)} مجوز تعریف‌شده — کنترل دسترسی پیش‌فرض‌ممنوع
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-56 overflow-y-auto scroll-slim rounded-lg border p-3">
              <ul className="space-y-1.5 text-sm">
                {grantedCatalog.length === 0 ? (
                  <li className="text-xs text-muted-foreground">مجوزی یافت نشد.</li>
                ) : (
                  grantedCatalog.map((p) => (
                    <li key={p.key} className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 line-clamp-1">{p.description}</span>
                      <code dir="ltr" className="shrink-0 text-[10px] text-muted-foreground">
                        {p.key}
                      </code>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Counts + phase 2 status */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
              شمارش موجودیت‌ها
            </CardTitle>
            <CardDescription className="text-xs">
              داده‌های واقعی ثبت‌شده تا کنون
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">کاربران سامانه</p>
              <p className="mt-1 text-lg font-bold">{users >= 0 ? faNum(users) : "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                دپارتمان‌ها
              </p>
              <p className="mt-1 text-lg font-bold">{departments >= 0 ? faNum(departments) : "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">تیکت‌های باز</p>
              <p className="mt-1 text-lg font-bold">{openTickets >= 0 ? faNum(openTickets) : "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">رخدادهای حسابرسی</p>
              <p className="mt-1 text-lg font-bold">{auditRows >= 0 ? faNum(auditRows) : "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ماژول‌های فعال برای شما</CardTitle>
            <CardDescription className="text-xs leading-5">
              فقط ماژول‌هایی نمایش داده می‌شوند که مجوز واقعی آن را دارید.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {modules.length === 0 ? (
              <p className="text-sm text-muted-foreground">ماژولی برای حساب شما فعال نیست.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {modules.map((m) => (
                  <li key={m.href}>
                    <Link
                      href={m.href}
                      className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/70"
                    >
                      <span className="text-primary">{m.icon}</span>
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              این داشبورد فقط داده‌های واقعی نمایش می‌دهد؛ هیچ کنترل تزئینی یا غیرکارکردی وجود ندارد.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
