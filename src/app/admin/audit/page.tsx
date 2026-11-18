import { ScrollText } from "lucide-react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { AuditViewer } from "@/components/admin/audit-viewer";

export const metadata = { title: "گزارش حسابرسی" };
export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "admin.audit.view");
  if (!allowed) {
    return <AccessDenied title="دسترسی به گزارش حسابرسی ندارید" />;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <ScrollText className="h-6 w-6 text-primary" aria-hidden="true" />
          گزارش حسابرسی
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          تمام رخدادهای امنیتی و مدیریتی سامانه — ورودها، تغییر مجوزها، عملیات تیکت و فایل،
          تنظیمات و رخدادهای سامانه. این صفحه فقط‌خواندنی است و رخدادها از هیچ مسیری حذف نمی‌شوند.
        </p>
      </section>

      <AuditViewer />
    </div>
  );
}
