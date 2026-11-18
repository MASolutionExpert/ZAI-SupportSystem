import { BookOpenText } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { KbManager, type KbPermissions } from "@/components/kb/kb-manager";

export const metadata = { title: "مخزن دانش" };
export const dynamic = "force-dynamic";

export default async function AdminKbPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [canView, canManageCollections, canAssignDepartments, canUpload, canDeleteDoc, canReprocess, canQaCreate, canQaEdit, canQaPublish] =
    await Promise.all([
      can(user.id, "kb.view"),
      can(user.id, "kb.collections.manage"),
      can(user.id, "kb.departments.assign"),
      can(user.id, "kb.documents.upload"),
      can(user.id, "kb.documents.delete"),
      can(user.id, "kb.documents.reprocess"),
      can(user.id, "kb.qa.create"),
      can(user.id, "kb.qa.edit"),
      can(user.id, "kb.qa.publish"),
    ]);

  const hasPageAccess = canView || canQaCreate || canManageCollections || canUpload;
  if (!hasPageAccess) {
    return <AccessDenied title="دسترسی به مخزن دانش ندارید" />;
  }

  const departments = await db.department.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  const permissions: KbPermissions = {
    canView,
    canManageCollections,
    canAssignDepartments,
    canUpload,
    canDeleteDoc,
    canReprocess,
    canQaCreate,
    canQaEdit,
    canQaPublish,
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <BookOpenText className="h-6 w-6 text-primary" aria-hidden="true" />
          مخزن دانش
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          اسناد سازمانی، مجموعه‌های دانش و پرسش و پاسخ رسمی. پاسخ‌های دستیار هوشمند فقط از این مخزن تأمین می‌شود؛
          محتوای فهرست‌شده و منتشرشده بلافاصله در جست‌وجوی معنایی و کلیدواژه‌ای قابل استفاده است.
        </p>
      </section>

      <KbManager permissions={permissions} departments={departments} />
    </div>
  );
}
