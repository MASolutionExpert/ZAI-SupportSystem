import Link from "next/link";
import { redirect } from "next/navigation";
import { Headset, ShieldCheck } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { resolveLandingPath } from "@/lib/rbac/service";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "ورود کارکنان" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect(
      user.mustChangePassword ? "/change-password" : await resolveLandingPath(user.id)
    );
  }

  const orgName = await getSetting<string>(SETTING_KEYS.ORG_NAME);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/70">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Headset className="h-4 w-4" aria-hidden="true" />
            </span>
            {orgName}
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            بازگشت به صفحه اصلی
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-xl sm:text-2xl font-bold">ورود به محیط کارکنان</h1>
            <p className="text-sm text-muted-foreground leading-6">
              این بخش ویژه اپراتورهای پشتیبانی و مدیران سازمان است.
            </p>
          </div>

          <LoginForm />

          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            ورودها ثبت و حسابرسی می‌شوند؛ تلاش‌های ناموفق موقتاً حساب را قفل می‌کند.
          </p>
        </div>
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-3 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {orgName}
        </div>
      </footer>
    </div>
  );
}
