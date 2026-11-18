import { Settings } from "lucide-react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { OrgSettingsForm } from "@/components/admin/org-settings-form";

export const metadata = { title: "تنظیمات سامانه" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "admin.settings.manage");
  if (!allowed) {
    return <AccessDenied title="دسترسی به تنظیمات سامانه ندارید" />;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <Settings className="h-6 w-6 text-primary" aria-hidden="true" />
          تنظیمات سامانه
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          تنظیمات سراسری سازمان؛ تغییرات بدون نیاز به راه‌اندازی مجدد بلافاصله در صفحات عمومی
          اعمال می‌شود و در گزارش حسابرسی ثبت می‌گردد.
        </p>
      </section>

      <OrgSettingsForm />
    </div>
  );
}
