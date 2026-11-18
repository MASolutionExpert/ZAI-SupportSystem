import { BarChart3 } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { ReportsWorkspace } from "@/components/admin/reports-workspace";

export const metadata = { title: "گزارش‌های مدیریتی" };
export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [canViewTickets, canViewAi, canExportCsv] = await Promise.all([
    can(user.id, "admin.reports.view"),
    can(user.id, "ai.usage.view"),
    can(user.id, "tickets.export"),
  ]);

  if (!canViewTickets && !canViewAi) {
    return <AccessDenied title="دسترسی به گزارش‌های مدیریتی ندارید" />;
  }

  const departments = await db.department.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <BarChart3 className="h-6 w-6 text-primary" aria-hidden="true" />
          گزارش‌های مدیریتی
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          آمار واقعی محاسبه‌شده لحظه‌ای از پایگاه داده: روند تیکت‌ها، کارنامه اپراتورها، عدالت
          تخصیص و مصرف دستیار هوشمند. هیچ عددی در این صفحه ساختگی نیست.
        </p>
      </section>

      <ReportsWorkspace
        canViewTickets={canViewTickets}
        canViewAi={canViewAi}
        canExportCsv={canExportCsv}
        departments={departments}
      />
    </div>
  );
}
