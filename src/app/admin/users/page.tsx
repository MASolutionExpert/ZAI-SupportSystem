import { redirect } from "next/navigation";
import { UsersRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { UserManager } from "@/components/admin/user-manager";

export const metadata = { title: "کاربران و اپراتورها" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "admin.users.manage");
  if (!allowed) return <AccessDenied />;

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <UsersRound className="h-6 w-6 text-primary" aria-hidden="true" />
          کاربران و اپراتورها
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مدیریت حساب‌ها: فعال‌سازی/تعلیق، بازنشانی رمز، انتساب نقش و دپارتمان، در دسترس بودن برای ارجاع و استثناهای مجوز.
          همه اقدامات در گزارش حسابرسی ثبت می‌شوند.
        </p>
      </section>

      <UserManager canManage />
    </div>
  );
}
