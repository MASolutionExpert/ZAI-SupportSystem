import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata = { title: "تغییر رمز عبور" };

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const orgName = await getSetting<string>(SETTING_KEYS.ORG_NAME);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/70">
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground mx-auto">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold">تغییر رمز عبور</h1>
            <p className="text-sm text-muted-foreground leading-6">
              {user.mustChangePassword
                ? "برای امنیت بیشتر، پس از نخستین ورود باید رمز عبور خود را تغییر دهید."
                : "رمز عبور جدید خود را تنظیم کنید."}
            </p>
          </div>

          <ChangePasswordForm mustChange={user.mustChangePassword} />

          <p className="text-center text-xs text-muted-foreground">
            {orgName} — رمز عبور با الگوریتم امن ذخیره می‌شود و هرگز نمایان نمی‌ماند.
          </p>
        </div>
      </main>
    </div>
  );
}
