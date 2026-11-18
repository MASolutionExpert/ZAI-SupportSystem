import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LifeBuoy, ShieldCheck, TicketCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { PortalApp } from "@/components/portal/portal-app";

export const metadata: Metadata = { title: "پورتال مراجعان" };

/**
 * Public customer portal (Phase 4) — ticket submission with a national ID
 * and OTP-gated history. force-dynamic is REQUIRED: the department list and
 * org name must reflect admin changes immediately without a rebuild.
 */
export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const [orgName, departments] = await Promise.all([
    getSetting<string>(SETTING_KEYS.ORG_NAME),
    db.department.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        iconKey: true,
        description: true,
      },
    }),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/60">
      {/* Minimal header */}
      <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 font-semibold text-sm sm:text-base min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
              <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="truncate">{orgName}</span>
          </span>
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            بازگشت به صفحه اصلی
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6">
        {/* Hero */}
        <section className="py-8 sm:py-10 text-center sd-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 mb-4">
            <TicketCheck className="h-3.5 w-3.5" aria-hidden="true" />
            ثبت تیکت و پیگیری با کد ملی و رمز عبور
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">
            پورتال مراجعان
          </h1>
          <p className="mt-3 text-muted-foreground text-sm sm:text-base leading-7 max-w-2xl mx-auto text-pretty">
            درخواست پشتیبانی خود را با کد ملی، نام و رمز عبور به‌صورت تیکت ثبت کنید؛ درخواست شما
            به‌صورت عادلانه به اپراتور دپارتمان مربوطه ارجاع می‌شود و می‌توانید روند رسیدگی و پاسخ‌ها
            را در هر لحظه با ورود به همین صفحه دنبال کنید.
          </p>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            کد ملی شما فقط برای پیگیری درخواست استفاده می‌شود و هرگز کامل نمایش داده نمی‌شود.
          </p>
        </section>

        {/* Portal application */}
        <section aria-label="سامانه ثبت و پیگیری تیکت" className="pb-14">
          <PortalApp departments={departments} />
        </section>
      </main>

      {/* Sticky footer — pinned to the viewport bottom on short pages,
          pushed naturally below the fold on long pages */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            © {new Date().getFullYear()} {orgName} — تمام حقوق محفوظ است.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            حساب مراجعان با کد ملی و رمز عبور
          </span>
        </div>
      </footer>
    </div>
  );
}
