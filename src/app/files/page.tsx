import { redirect } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { can, getEffectivePermissions } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { FileHub } from "@/components/files/file-hub";
import { listFilesDepartmentsInScope } from "@/lib/files/service";

export const metadata = { title: "فایل‌های مشترک" };
export const dynamic = "force-dynamic";

export default async function FilesWorkspacePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "files.access");
  if (!allowed) return <AccessDenied title="دسترسی به فایل‌های مشترک ندارید" />;

  const [{ scopeAll, departments }, canUpload, canDownload, canCreateFolder, canRename, canMove, canReplace, canDelete, canManageSettings, canViewUsage] =
    await Promise.all([
      listFilesDepartmentsInScope(user.id),
      can(user.id, "files.upload"),
      can(user.id, "files.download"),
      can(user.id, "files.folders.create"),
      can(user.id, "files.rename"),
      can(user.id, "files.move"),
      can(user.id, "files.replace"),
      can(user.id, "files.delete"),
      can(user.id, "admin.storage.manage"),
      can(user.id, "files.quotas.manage"),
    ]);

  return (
    <div className="space-y-6 max-w-5xl sd-fade-up">
      <section>
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <FolderOpen className="h-6 w-6 text-primary" aria-hidden="true" />
          فایل‌های مشترک
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مرکز اشتراک فایل دپارتمان‌ها — بارگذاری امن (بررسی محتوایی نوع فایل)، سهمیه‌ها، پوشه‌های تودرتو و
          دانلود فقط از مسیر مجاز؛ دامنه دسترسی شما سمت سرور اعمال می‌شود.
        </p>
      </section>

      <FileHub
        scopeAll={scopeAll}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        canUpload={canUpload}
        canDownload={canDownload}
        canCreateFolder={canCreateFolder}
        canRename={canRename}
        canMove={canMove}
        canReplace={canReplace}
        canDelete={canDelete}
        canManageSettings={canManageSettings}
        canViewUsage={canViewUsage}
      />
    </div>
  );
}
