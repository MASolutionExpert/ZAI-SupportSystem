import { redirect } from "next/navigation";
import {
  Building2,
  LifeBuoy,
  Sparkles,
  Star,
  Ticket,
  TicketCheck,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { can, getEffectivePermissions } from "@/lib/rbac/service";
import { listDepartmentsInScope } from "@/lib/rbac/scope";
import { getDepartmentIcon } from "@/lib/department-icons";
import { AccessDenied } from "@/components/admin/access-denied";
import { AvailabilityToggle } from "@/components/staff/availability-toggle";
import { CitizensThreads } from "@/components/staff/citizens-threads";
import { ConversationsInbox } from "@/components/staff/conversations-inbox";
import { TicketsQueue } from "@/components/staff/tickets-queue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { faNum } from "@/lib/format";

export const metadata = { title: "میز پشتیبانی" };
export const dynamic = "force-dynamic";

const SUPPORT_PERMISSION_KEYS = [
  "tickets.view",
  "tickets.view.department",
  "tickets.view.all",
  "tickets.reply",
  "tickets.notes.add",
  "tickets.status.change",
  "tickets.assign",
  "tickets.transfer",
  "tickets.create.internal",
  "tickets.customer.history.view",
];

export default async function SupportWorkspacePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = await can(user.id, "tickets.view");
  if (!allowed) return <AccessDenied title="دسترسی به میز پشتیبانی ندارید" />;

  const [
    departments,
    effective,
    canReply,
    canNote,
    canStatus,
    canAssign,
    canTransfer,
    canInternal,
    canHistory,
  ] = await Promise.all([
    listDepartmentsInScope(user.id),
    getEffectivePermissions(user.id),
    can(user.id, "tickets.reply"),
    can(user.id, "tickets.notes.add"),
    can(user.id, "tickets.status.change"),
    can(user.id, "tickets.assign"),
    can(user.id, "tickets.transfer"),
    can(user.id, "tickets.create.internal"),
    can(user.id, "tickets.customer.history.view"),
  ]);

  const supportPermissions = SUPPORT_PERMISSION_KEYS.filter((k) => effective.has(k));
  const managerDepartments = departments.filter((d) => d.isManager);

  return (
    <div className="space-y-6 max-w-5xl sd-fade-up">
      <section>
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <LifeBuoy className="h-6 w-6 text-primary" aria-hidden="true" />
          میز پشتیبانی
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          فضای کاری اپراتورها — دامنه شما از انتساب دپارتمان‌ها تعیین می‌شود و سمت سرور اعمال می‌گردد.
        </p>
      </section>

      {/* Availability */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">وضعیت من در ارجاع</CardTitle>
          <CardDescription className="text-xs">
            این وضعیت اکنون ثبت و حسابرسی می‌شود؛ موتور توزیع عادلانه تیکت‌ها از آن استفاده می‌کند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityToggle initialAvailable={user.isAvailable} accountActive={user.status === "ACTIVE"} />
        </CardContent>
      </Card>

      {/* Ticket management (Phase 4 — the primary operator surface) */}
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Ticket className="h-5 w-5 text-primary" aria-hidden="true" />
            مدیریت تیکت‌ها (فاز ۴)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            صف تیکت‌ها، ارجاع عادلانه، یادداشت‌های داخلی و انتقال بین دپارتمان‌ها اکنون فعال است؛
            تیکت‌های ثبت‌شده در پورتال مراجعان، ثبت داخلی اپراتور و ارجاع از گفتگوی زنده به همین صف می‌رسند.
          </p>
        </div>
        <TicketsQueue
          canReply={canReply}
          canNote={canNote}
          canStatus={canStatus}
          canAssign={canAssign}
          canTransfer={canTransfer}
          canInternal={canInternal}
          canHistory={canHistory}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        />
      </section>

      {/* Citizen-centric threads (Phase 8 — one row per کد ملی with the
          citizen's last messages; department-scoped server-side) */}
      {canHistory ? <CitizensThreads /> : null}

      {/* Customer conversations inbox (Phase 3 — live chat + operator handoff) */}
      <ConversationsInbox
        canReply={canReply}
        canResolve={canStatus}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      />

      {/* Departments in scope */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            دپارتمان‌های در دامنه شما
          </CardTitle>
          <CardDescription className="text-xs">
            {departments.length > 0
              ? `${faNum(departments.length)} دپارتمان — ${managerDepartments.length > 0 ? `${faNum(managerDepartments.length)} مورد با مسئولیت مدیر` : "بدون مسئولیت مدیریتی"}`
              : "هنوز به دپارتمانی منصوب نشده‌اید؛ با مدیر سامانه تماس بگیرید."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              هیچ دپارتمانی در دامنه شما نیست.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {departments.map((d) => {
                const Icon = getDepartmentIcon(d.iconKey);
                return (
                  <li key={d.id} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {d.name}
                          {d.isManager ? (
                            <Badge variant="outline" className="gap-1 text-amber-700 border-amber-200">
                              <Star className="h-3 w-3" aria-hidden="true" />
                              مدیر
                            </Badge>
                          ) : null}
                        </p>
                        {d.aiEnabled ? (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Sparkles className="h-3 w-3" aria-hidden="true" />
                            دستیار هوشمند فعال
                          </p>
                        ) : (
                          <p className="mt-0.5 text-xs text-muted-foreground">پاسخ‌گویی اپراتور</p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Permissions in scope */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TicketCheck className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            توانمندی‌های شما در میز پشتیبانی
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {supportPermissions.length === 0 ? (
              <li className="text-xs text-muted-foreground">مجوز پشتیبانی ثبت نشده است.</li>
            ) : (
              supportPermissions.map((k) => (
                <li key={k}>
                  <Badge variant="secondary" className="font-normal">
                    <code dir="ltr" className="text-[10px]">{k}</code>
                  </Badge>
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
