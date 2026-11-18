import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can, getEffectivePermissions } from "@/lib/rbac/service";
import { AdminShell } from "@/components/shell/admin-shell";
import { AccessDenied } from "@/components/admin/access-denied";

/**
 * Shared staff shell gate — session checks, deny-by-default permission gate,
 * and the AdminShell with permission-filtered navigation.
 * Used by /admin, /support and /files layouts.
 */
export async function StaffShell({
  permission,
  workspace,
  children,
}: {
  permission: string;
  workspace: "admin" | "support" | "files";
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");

  const [role, permissions, allowed] = await Promise.all([
    db.role.findUnique({ where: { key: user.roleKey } }),
    getEffectivePermissions(user.id),
    can(user.id, permission),
  ]);

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
        <AccessDenied />
      </div>
    );
  }

  return (
    <AdminShell
      user={{ name: user.name, username: user.username, roleKey: user.roleKey }}
      roleName={role?.name ?? user.roleKey}
      permissionCount={permissions.size}
      permissions={[...permissions]}
      workspace={workspace}
    >
      {children}
    </AdminShell>
  );
}
