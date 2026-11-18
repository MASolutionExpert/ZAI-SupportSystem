import { redirect } from "next/navigation";
import { UsersRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { CitizensManager } from "@/components/admin/citizens-manager";

export const metadata = { title: "کاربران سامانه" };
export const dynamic = "force-dynamic";

/**
 * Superadmin surface for citizen accounts (کاربران سامانه) — Phase 8.
 * List, search (name or full national ID — HMAC-resolved server-side),
 * edit, reset password, block/unblock and delete. The raw national ID is
 * never displayed: masked tail only (SECURITY.md §4).
 */
export default async function AdminCitizensPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "admin.citizens.manage");
  if (!allowed) return <AccessDenied />;

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <UsersRound className="h-6 w-6 text-primary" aria-hidden="true" />
          کاربران سامانه
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مدیریت حساب مراجعان: جستجو با نام یا کد ملی، ویرایش نام، بازنشانی رمز عبور فراموش‌شده،
          مسدودسازی و حذف حساب. همه اقدامات در گزارش حسابرسی ثبت می‌شود و کد ملی هرگز کامل نمایش داده نمی‌شود.
        </p>
      </section>

      <CitizensManager />
    </div>
  );
}
