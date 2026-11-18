import {
  Activity,
  CheckCircle2,
  Database,
  HardDrive,
  Info,
  ScrollText,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { redirect } from "next/navigation";
import { db, checkDatabase } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { countActiveSessions } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { getEnv } from "@/lib/env";
import { getAppVersion } from "@/lib/version";
import { getStorageUsageBytes } from "@/lib/storage";
import { AccessDenied } from "@/components/admin/access-denied";
import { HealthRefreshButton } from "@/components/admin/health-refresh-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { faBytes, faNum } from "@/lib/format";

export const metadata = { title: "سلامت سامانه" };
export const dynamic = "force-dynamic";

const processStartedAt = Date.now();

function uptimeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${faNum(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes > 0
      ? `${faNum(hours)} ساعت و ${faNum(restMinutes)} دقیقه`
      : `${faNum(hours)} ساعت`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0
    ? `${faNum(days)} روز و ${faNum(restHours)} ساعت`
    : `${faNum(days)} روز`;
}

export default async function AdminHealthPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "admin.dashboard.view");
  if (!allowed) {
    return <AccessDenied title="دسترسی به اطلاعات سلامت سامانه ندارید" />;
  }

  const dbStart = Date.now();
  const [version, databaseOk, activeSessions, storageBytes] = await Promise.all([
    getAppVersion(),
    checkDatabase(),
    countActiveSessions().catch(() => -1),
    getStorageUsageBytes().catch(() => -1),
  ]);
  const dbLatencyMs = Date.now() - dbStart;

  const [
    users,
    departments,
    ticketsOpen,
    ticketsInProgress,
    ticketsWaiting,
    ticketsResolved,
    conversationsActive,
    kbDocuments,
    sharedFiles,
    auditRows,
  ] = await Promise.all([
    db.user.count().catch(() => -1),
    db.department.count().catch(() => -1),
    db.ticket.count({ where: { status: "OPEN" } }).catch(() => -1),
    db.ticket.count({ where: { status: "IN_PROGRESS" } }).catch(() => -1),
    db.ticket.count({ where: { status: "WAITING_CUSTOMER" } }).catch(() => -1),
    db.ticket.count({ where: { status: "RESOLVED" } }).catch(() => -1),
    db.conversation.count({ where: { mode: { not: "RESOLVED" } } }).catch(() => -1),
    db.knowledgeDocument.count().catch(() => -1),
    db.sharedFile.count().catch(() => -1),
    db.auditLog.count().catch(() => -1),
  ]);

  const memory = process.memoryUsage();
  let envValid = true;
  let env = {
    appUrlSet: false,
    forceSecureCookies: false,
    bootstrapOnStartup: true,
    sessionTtlHours: 168,
    loginMaxAttempts: 5,
    loginLockMinutes: 15,
  };
  try {
    const parsed = getEnv();
    envValid = true;
    env = {
      appUrlSet: Boolean(parsed.APP_URL),
      forceSecureCookies: parsed.FORCE_SECURE_COOKIES === "true",
      bootstrapOnStartup: parsed.BOOTSTRAP_ON_STARTUP === "true",
      sessionTtlHours: parsed.SESSION_TTL_HOURS,
      loginMaxAttempts: parsed.LOGIN_MAX_ATTEMPTS,
      loginLockMinutes: parsed.LOGIN_LOCK_MINUTES,
    };
  } catch {
    envValid = false;
  }

  const ticketsOpenTotal = (ticketsOpen >= 0 ? ticketsOpen : 0) + (ticketsInProgress >= 0 ? ticketsInProgress : 0) + (ticketsWaiting >= 0 ? ticketsWaiting : 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="sd-fade-up flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
            <Activity className="h-6 w-6 text-primary" aria-hidden="true" />
            سلامت و اطلاعات عملیاتی سامانه
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            مقادیر واقعی لحظه‌ای از فرایند سرور و پایگاه داده؛ اندازه‌گیری در لحظه بارگذاری این صفحه.
          </p>
        </div>
        <HealthRefreshButton />
      </section>

      {/* Core health */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              پایگاه داده
            </CardDescription>
            <CardTitle className="text-base flex items-center gap-2">
              {databaseOk ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  سالم
                </>
              ) : (
                <Badge variant="destructive">قطع</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            تأخیر پینگ: {faNum(dbLatencyMs)} میلی‌ثانیه
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Timer className="h-3.5 w-3.5" aria-hidden="true" />
              عمر پردازش
            </CardDescription>
            <CardTitle className="text-base">{uptimeLabel((Date.now() - processStartedAt) / 1000)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            نسخه <span dir="ltr">v{version}</span> — PID {faNum(process.pid)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              حافظه فرایند
            </CardDescription>
            <CardTitle className="text-base">{faBytes(memory.rss)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            هیپ استفاده‌شده: {faBytes(memory.heapUsed)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
              فضای ذخیره‌سازی مصرفی
            </CardDescription>
            <CardTitle className="text-base">{faBytes(storageBytes)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {sharedFiles >= 0 ? `${faNum(sharedFiles)} فایل مشترک` : "—"}
          </CardContent>
        </Card>
      </section>

      {/* Operational counts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">موجودی عملیاتی</CardTitle>
            <CardDescription className="text-xs">شمارش زنده جداول اصلی</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "تیکت باز (همه وضعیت‌های فعال)", value: ticketsOpenTotal },
                { label: "تیکت جدید", value: ticketsOpen },
                { label: "در حال بررسی", value: ticketsInProgress },
                { label: "در انتظار مراجع", value: ticketsWaiting },
                { label: "حل‌شده", value: ticketsResolved },
                { label: "گفتگوی فعال", value: conversationsActive },
                { label: "اسناد مخزن دانش", value: kbDocuments },
                { label: "فایل مشترک", value: sharedFiles },
                { label: "کاربران", value: users },
                { label: "دپارتمان‌ها", value: departments },
                { label: "نشست‌های فعال", value: activeSessions },
                { label: "رخدادهای حسابرسی", value: auditRows },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border p-2.5">
                  <dt className="text-xs text-muted-foreground">{item.label}</dt>
                  <dd className="mt-0.5 text-base font-bold">{item.value >= 0 ? faNum(item.value) : "—"}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              پیکربندی امنیتی اجرا
            </CardTitle>
            <CardDescription className="text-xs">
              مقادیر مؤثر از متغیرهای محیطی اعتبارسنجی‌شده
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">اعتبارسنجی متغیرهای محیطی</span>
              <Badge variant="outline" className={envValid ? "text-emerald-700 border-emerald-300" : "text-destructive border-destructive"}>
                {envValid ? "معتبر" : "نامعتبر"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">انقضای نشست</span>
              <span>{faNum(env.sessionTtlHours)} ساعت</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">سقف تلاش ورود</span>
              <span>{faNum(env.loginMaxAttempts)} تلاش</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">قفل حساب پس از تلاش‌های ناموفق</span>
              <span>{faNum(env.loginLockMinutes)} دقیقه</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">کوکی امن (HTTPS)</span>
              <Badge variant="outline" className={env.forceSecureCookies ? "text-emerald-700 border-emerald-300" : ""}>
                {env.forceSecureCookies ? "فعال" : "خاموش (توسعه)"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Bootstrap خودکار در راه‌اندازی</span>
              <Badge variant="outline">{env.bootstrapOnStartup ? "فعال" : "خاموش"}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">APP_URL تعریف‌شده</span>
              <Badge variant="outline" className={env.appUrlSet ? "text-emerald-700 border-emerald-300" : ""}>
                {env.appUrlSet ? "بله — بررسی سخت‌گیرانه مبدا" : "خیر — مبتنی بر Host"}
              </Badge>
            </div>
            <p className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              وضعیت عمومی سرویس برای مانیتورینگ خارجی: <code dir="ltr">GET /api/health</code>
            </p>
          </CardContent>
        </Card>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
        سوابق عملیاتی تفصیلی در «گزارش حسابرسی» ثبت می‌شود؛ این صفحه فقط‌خواندنی است و هیچ
        عملیاتی از این مسیر انجام نمی‌شود.
      </p>
    </div>
  );
}
