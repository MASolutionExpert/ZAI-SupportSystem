import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { RoleManager } from "@/components/admin/role-manager";

export const metadata = { title: "نقش‌ها و مجوزها" };
export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [rolesAllowed, permissionsAllowed] = await Promise.all([
    can(user.id, "admin.roles.manage"),
    can(user.id, "admin.permissions.manage"),
  ]);

  if (!rolesAllowed && !permissionsAllowed) return <AccessDenied />;

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          نقش‌ها و مجوزها
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ایجاد نقش‌های سفارشی، تنظیم مجوزهای هر نقش و مدیریت استثناهای کاربر. کنترل دسترسی از نوع پیش‌فرض‌ممنوع است:
          هر مجوز صریحاً باید به نقش یا کاربر داده شود.
        </p>
      </section>

      <RoleManager canManageRoles={rolesAllowed} canManagePermissions={permissionsAllowed} />
    </div>
  );
}
