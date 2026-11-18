import { Building2 } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/admin/access-denied";
import { DepartmentManager } from "@/components/admin/department-manager";

export const metadata = { title: "مدیریت دپارتمان‌ها" };
export const dynamic = "force-dynamic";

export default async function AdminDepartmentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "admin.departments.manage");
  if (!allowed) return <AccessDenied />;

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <Building2 className="h-6 w-6 text-primary" aria-hidden="true" />
          مدیریت دپارتمان‌ها
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ایجاد و ویرایش دپارتمان‌ها، ترتیب نمایش، آیکن، نمایش عمومی و فعال‌سازی دستیار هوشمند برای هر دپارتمان.
          تغییرات بلافاصله در صفحه اصلی عمومی اعمال می‌شود — بدون نیاز به استقرار مجدد.
        </p>
      </section>

      <DepartmentManager canManage />
    </div>
  );
}
