import { BotMessageSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac/service";
import { AccessDenied } from "@/components/admin/access-denied";
import { RagWorkspace } from "@/components/admin/rag-workspace";

export const metadata = { title: "موتور دانش (RAG)" };
export const dynamic = "force-dynamic";

/**
 * Admin RAG engine panel (task §11) — engine settings, index health, jobs,
 * traces and evaluation runs. Access reuses the AI-settings permission.
 */
export default async function AdminRagPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "ai.settings.access");
  if (!allowed) {
    return <AccessDenied title="دسترسی به موتور دانش ندارید" />;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="sd-fade-up">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <BotMessageSquare className="h-6 w-6 text-primary" aria-hidden="true" />
          موتور دانش (RAG)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          سلامت ایندکس، صف پردازش اسناد، ردگیری‌های بازیابی، تنظیمات موتور و اجراهای ارزیابی —
          اعمال تنظیمات بدون نیاز به راه‌اندازی مجدد.
        </p>
      </section>

      <RagWorkspace />
    </div>
  );
}
