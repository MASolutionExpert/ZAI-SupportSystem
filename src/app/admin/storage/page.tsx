import { HardDrive } from "lucide-react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { StorageAdmin } from "@/components/admin/storage-admin";

export const metadata = { title: "مدیریت ذخیره‌سازی" };
export const dynamic = "force-dynamic";

export default async function AdminStoragePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [canManage, canViewQuotas] = await Promise.all([
    can(user.id, "admin.storage.manage"),
    can(user.id, "files.quotas.manage"),
  ]);

  if (!canManage && !canViewQuotas) {
    return <AccessDenied title="دسترسی به مدیریت ذخیره‌سازی ندارید" />;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <HardDrive className="h-6 w-6 text-primary" aria-hidden="true" />
          مدیریت ذخیره‌سازی
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          گزارش مصرف کل مرکز فایل و تنظیمات ظرفیت، سهمیه‌ها، پسوندهای مجاز و نقطه اتصال
          آنتی‌ویروس — همان کنترل‌های فضای کاری فایل، یکپارچه در یک صفحه مدیریتی.
        </p>
      </section>

      <StorageAdmin canEdit={canManage} />
    </div>
  );
}
