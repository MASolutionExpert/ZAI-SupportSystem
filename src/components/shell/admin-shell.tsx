"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FlaskConical,
  Headset,
  LayoutDashboard,
  LifeBuoy,
  FolderOpen,
  BookOpenText,
  Building2,
  UsersRound,
  UserCheck,
  ShieldCheck,
  BotMessageSquare,
  ScrollText,
  BarChart3,
  HardDrive,
  Settings,
  Activity,
  LogOut,
  Menu,
  KeyRound,
  Hammer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/staff/notifications-bell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ShellUser = {
  name: string;
  username: string;
  roleKey: string;
};

type NavItem = {
  label: string;
  href: string | null;
  icon: React.ReactNode;
  phase?: string;
  requireAll?: string[]; // all of these permissions
  requireAny?: string[]; // at least one of these permissions
};

function NavList({
  items,
  activePath,
  onNavigate,
}: {
  items: NavItem[];
  activePath: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="ناوبری محیط کارکنان" className="space-y-1">
      {items.map((item) => {
        const active = item.href ? activePath === item.href || activePath.startsWith(item.href + "/") : false;
        const content = (
          <>
            <span className="shrink-0 [&>svg]:h-4.5 [&>svg]:w-4.5">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.phase ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                {item.phase}
              </Badge>
            ) : null}
          </>
        );

        if (!item.href) {
          return (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/70 select-none"
              aria-disabled="true"
            >
              {content}
            </div>
          );
        }

        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            className={[
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-secondary font-semibold text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted/70",
            ].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({
  user,
  roleName,
  permissionCount,
  permissions,
  workspace,
  children,
}: {
  user: ShellUser;
  roleName: string;
  permissionCount: number;
  permissions: string[];
  workspace: "admin" | "support" | "files";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const has = (...keys: string[]) => keys.every((k) => permissions.includes(k));
  const hasAny = (...keys: string[]) => keys.some((k) => permissions.includes(k));

  const navItems: NavItem[] = [
    { label: "داشبورد", href: "/admin", icon: <LayoutDashboard />, requireAll: ["admin.dashboard.view"] },
    { label: "میز پشتیبانی", href: "/support", icon: <LifeBuoy />, requireAll: ["tickets.view"] },
    { label: "فایل‌های مشترک", href: "/files", icon: <FolderOpen />, requireAll: ["files.access"] },
    { label: "دپارتمان‌ها", href: "/admin/departments", icon: <Building2 />, requireAll: ["admin.departments.manage"] },
    { label: "کاربران و اپراتورها", href: "/admin/users", icon: <UsersRound />, requireAll: ["admin.users.manage"] },
    { label: "کاربران سامانه", href: "/admin/citizens", icon: <UserCheck />, requireAll: ["admin.citizens.manage"] },
    { label: "نقش‌ها و مجوزها", href: "/admin/roles", icon: <ShieldCheck />, requireAny: ["admin.roles.manage", "admin.permissions.manage"] },
    { label: "مخزن دانش", href: "/admin/kb", icon: <BookOpenText />, requireAny: ["kb.view", "kb.qa.create", "kb.collections.manage", "kb.documents.upload"] },
    { label: "تنظیمات هوش مصنوعی", href: "/admin/ai", icon: <BotMessageSquare />, requireAny: ["ai.settings.access", "ai.provider.configure", "ai.department.settings.manage", "ai.usage.view"] },
    { label: "موتور دانش (RAG)", href: "/admin/rag", icon: <FlaskConical />, requireAny: ["ai.settings.access", "ai.provider.configure"] },
    { label: "گزارش‌های مدیریتی", href: "/admin/reports", icon: <BarChart3 />, requireAny: ["admin.reports.view", "ai.usage.view"] },
    { label: "گزارش حسابرسی", href: "/admin/audit", icon: <ScrollText />, requireAll: ["admin.audit.view"] },
    { label: "مدیریت ذخیره‌سازی", href: "/admin/storage", icon: <HardDrive />, requireAny: ["admin.storage.manage", "files.quotas.manage"] },
    { label: "تنظیمات سامانه", href: "/admin/settings", icon: <Settings />, requireAll: ["admin.settings.manage"] },
    { label: "سلامت سامانه", href: "/admin/health", icon: <Activity />, requireAll: ["admin.dashboard.view"] },
  ].filter((item) => {
    if (item.requireAll && !has(...item.requireAll)) return false;
    if (item.requireAny && !hasAny(...item.requireAny)) return false;
    return true;
  });

  const workspaceTabs = [
    { key: "support" as const, label: "میز پشتیبانی", href: "/support", require: "tickets.view" },
    { key: "files" as const, label: "فایل‌های مشترک", href: "/files", require: "files.access" },
  ].filter((t) => permissions.includes(t.require));

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const sidebarBody = (
    <div className="flex flex-col gap-6 p-4 h-full">
      <div className="flex items-center gap-2.5 px-1">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Headset className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">محیط کارکنان</p>
          <p className="text-xs text-muted-foreground truncate">سامانه پشتیبانی سازمان</p>
        </div>
      </div>

      <NavList items={navItems} activePath={pathname} onNavigate={() => setMobileOpen(false)} />

      <div className="mt-auto rounded-lg border border-dashed p-3 text-xs text-muted-foreground leading-5">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Hammer className="h-3.5 w-3.5" aria-hidden="true" />
          فاز ۸ — حساب‌های مراجعان
        </span>
        <p className="mt-1">
          احراز مراجعان با کد ملی و رمز عبور (بدون پیامک)، کاربران سامانه در پنل مدیریت،
          گفتگوهای مراجعان در میز پشتیبانی و همه ماژول‌های فازهای قبل فعال‌اند.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-muted/40">
      {/* Desktop sidebar (RTL: right side per spec 7.1) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-e bg-background">
        {sidebarBody}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar with the two workspaces (پشتیبانی / فایل‌های مشترک) */}
        <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
            {/* Mobile nav */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="باز کردن منو">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>منوی ناوبری</SheetTitle>
                </SheetHeader>
                {sidebarBody}
              </SheetContent>
            </Sheet>

            <div className="hidden sm:flex items-center gap-1 rounded-lg bg-muted p-1">
              {workspaceTabs.map((tab) => (
                <Link
                  key={tab.key}
                  href={tab.href}
                  className={[
                    "rounded-md px-3 py-1.5 text-xs transition-colors",
                    workspace === tab.key
                      ? "bg-background font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                  aria-current={workspace === tab.key ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              ))}
              {workspaceTabs.length === 0 ? (
                <span className="rounded-md bg-background px-3 py-1.5 text-xs font-semibold shadow-sm">
                  پنل مدیریت
                </span>
              ) : null}
            </div>
            <span className="sm:hidden text-sm font-semibold">
              {workspace === "support" ? "میز پشتیبانی" : workspace === "files" ? "فایل‌های مشترک" : "پنل مدیریت"}
            </span>

            <div className="ms-auto flex items-center gap-2">
              <NotificationsBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-9 gap-2 px-2 sm:px-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-bold" aria-hidden="true">
                      {user.name.trim().charAt(0) || "ک"}
                    </span>
                    <span className="hidden sm:flex flex-col items-start leading-tight">
                      <span className="text-sm font-medium max-w-40 truncate">{user.name}</span>
                      <span className="text-[11px] text-muted-foreground">{roleName}</span>
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="space-y-0.5">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p dir="ltr" className="text-xs text-muted-foreground text-right">
                      @{user.username}
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled className="justify-between">
                    <span>{roleName}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {permissionCount} مجوز
                    </Badge>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/change-password" className="cursor-pointer">
                      <KeyRound className="ml-0 h-4 w-4" />
                      تغییر رمز عبور
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="text-destructive focus:text-destructive"
                  >
                    <LogOut className="ml-0 h-4 w-4" />
                    {loggingOut ? "در حال خروج…" : "خروج از حساب"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
