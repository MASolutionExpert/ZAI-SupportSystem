import Link from "next/link";
import { Headset, ShieldCheck, Clock, ArrowLeft, TicketCheck } from "lucide-react";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { listPublicDepartments, getDepartmentIcon } from "@/lib/departments";
import { getAppVersion } from "@/lib/version";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DepartmentCard } from "@/components/support/department-card";

/**
 * Public Customer Support Portal — landing page.
 * Departments are generated dynamically from the database (master spec 3.1):
 * activating a department in the admin panel adds its card here immediately,
 * deactivating/hiding it removes the card while its records stay preserved.
 *
 * force-dynamic is REQUIRED: the department list must reflect admin changes
 * immediately (no rebuild/redeploy) and must not be statically prerendered
 * at build time.
 */
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [orgName, orgTagline, orgIntro, departments, version] = await Promise.all([
    getSetting<string>(SETTING_KEYS.ORG_NAME),
    getSetting<string>(SETTING_KEYS.ORG_TAGLINE),
    getSetting<string>(SETTING_KEYS.ORG_SUPPORT_INTRO),
    listPublicDepartments(),
    getAppVersion(),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/60">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shrink-0">
              <Headset className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="font-bold text-base sm:text-lg truncate">{orgName}</span>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/login">
              ورود کارکنان
              <ArrowLeft className="ms-1 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6">
        <section className="py-12 sm:py-16 text-center sd-fade-up">
          <Badge variant="secondary" className="mb-4">
            <ShieldCheck className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
            پاسخ‌ها فقط بر اساس دانش رسمی سازمان
          </Badge>
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-balance">
            سلام! چگونه می‌توانیم کمک کنیم؟
          </h1>
          <p className="mt-3 sm:mt-4 text-muted-foreground text-sm sm:text-base leading-7 max-w-2xl mx-auto text-pretty">
            {orgIntro}
          </p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {orgTagline}
          </p>
        </section>

        {/* Customer portal CTA (Phase 4) */}
        <section aria-label="پورتال مراجعان" className="pb-8 sd-fade-up">
          <Link
            href="/portal"
            className="group flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50 sm:p-5"
          >
            <span className="flex min-w-0 items-center gap-3.5">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-emerald-50">
                <TicketCheck className="h-6 w-6" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold sm:text-base">پورتال مراجعان — ثبت تیکت و پیگیری</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground sm:text-sm">
                  درخواست پشتیبانی خود را با کد ملی ثبت کنید و روند رسیدگی آن را در هر لحظه دنبال کنید.
                </span>
              </span>
            </span>
            <ArrowLeft
              className="h-5 w-5 shrink-0 text-emerald-700 transition-transform group-hover:-translate-x-1"
              aria-hidden="true"
            />
          </Link>
        </section>

        {/* Departments (dynamic) */}
        <section aria-labelledby="departments-title" className="pb-16">
          <h2 id="departments-title" className="sr-only">
            انتخاب دپارتمان پشتیبانی
          </h2>
          {departments.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
              در حال حاضر دپارتمانی برای ارائه خدمت فعال نیست. لطفاً بعداً مراجعه کنید.
            </div>
          ) : (
            <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {departments.map((dept, index) => {
                const Icon = getDepartmentIcon(dept.iconKey);
                return (
                  <DepartmentCard
                    key={dept.id}
                    departmentId={dept.id}
                    name={dept.name}
                    description={dept.description}
                    welcomeMessage={dept.welcomeMessage}
                    aiEnabled={dept.aiEnabled}
                    icon={<Icon className="h-6 w-6" aria-hidden="true" />}
                    delay={index * 60}
                  />
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Sticky footer — pinned to viewport bottom on short pages, pushed
          naturally below the fold on long pages */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            © {new Date().getFullYear()} {orgName} — تمام حقوق محفوظ است.
          </span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              اطلاعات شما محرمانه می‌ماند
            </span>
            <span dir="ltr" className="tabular-nums">
              v{version}
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
