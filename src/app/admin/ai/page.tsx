import { BotMessageSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import {
  AiSettingsPanel,
  type AiDepartmentRow,
} from "@/components/ai/ai-settings-panel";

export const metadata = { title: "تنظیمات هوش مصنوعی" };
export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [canAccess, canConfigure, canCredentials, canTest, canDept, canUsage] =
    await Promise.all([
      can(user.id, "ai.settings.access"),
      can(user.id, "ai.provider.configure"),
      can(user.id, "ai.credentials.update"),
      can(user.id, "ai.connection.test"),
      can(user.id, "ai.department.settings.manage"),
      can(user.id, "ai.usage.view"),
    ]);

  if (!(canAccess || canConfigure || canDept || canUsage)) {
    return <AccessDenied title="دسترسی به تنظیمات هوش مصنوعی ندارید" />;
  }

  const departments = await db.department.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, aiEnabled: true, isActive: true },
  });

  const departmentRows: AiDepartmentRow[] = departments.map((department) => ({
    id: department.id,
    name: department.name,
    aiEnabled: department.aiEnabled,
  }));

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <BotMessageSquare className="h-6 w-6 text-primary" aria-hidden="true" />
          تنظیمات هوش مصنوعی
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          پیکربندی ارائه‌دهنده سرویس، کلید قطع کلی، رفتار پاسخ‌گویی هر دپارتمان و گزارش مصرف دستیار هوشمند.
          پاسخ‌ها فقط از مخزن دانش تأمین می‌شوند و ارجاع به اپراتور بر اساس حداقل اطمینان هر دپارتمان انجام می‌شود.
        </p>
      </section>

      <AiSettingsPanel
        canAccess={canAccess}
        canConfigure={canConfigure}
        canCredentials={canCredentials}
        canTest={canTest}
        canDept={canDept}
        canUsage={canUsage}
        departments={departmentRows}
      />
    </div>
  );
}
