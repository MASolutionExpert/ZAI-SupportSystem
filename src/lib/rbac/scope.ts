import { db } from "@/lib/db";

/**
 * Department scoping (PERMISSIONS.md §6).
 *
 * A permission key grants a *capability*; department membership grants the
 * *scope* in which that capability may be exercised. Scope resolution is the
 * single server-side source of truth — never trust client-provided department
 * identifiers without checking them against the resolved scope.
 *
 * Rules:
 *  - Global scope (all departments) is granted by explicit "all-scope"
 *    permission keys — SUPER_ADMIN holds them all; a narrowly-scoped manager
 *    could also receive one via overrides/custom roles.
 *  - Otherwise scope = the user's department memberships.
 *  - Scope is enforced server-side in API guards; hiding UI is never enough.
 */

/** Permission keys that unlock the full department scope. */
const GLOBAL_SCOPE_PERMISSIONS = [
  "tickets.view.all",
  "files.all.manage",
  "admin.departments.manage",
] as const;

export type DepartmentScope = {
  /** true → user may act across every department (present + future). */
  all: boolean;
  /** Concrete department ids when `all` is false (empty → no scope). */
  departmentIds: string[];
};

export async function resolveDepartmentScope(userId: string): Promise<DepartmentScope> {
  const { can } = await import("./service");

  const checks = await Promise.all(
    GLOBAL_SCOPE_PERMISSIONS.map((key) => can(userId, key))
  );
  if (checks.some(Boolean)) return { all: true, departmentIds: [] };

  const memberships = await db.departmentMembership.findMany({
    where: { userId },
    select: { departmentId: true },
  });
  return { all: false, departmentIds: memberships.map((m) => m.departmentId) };
}

/** Does the user hold scope over a specific department? */
export async function hasDepartmentAccess(
  userId: string,
  departmentId: string
): Promise<boolean> {
  const scope = await resolveDepartmentScope(userId);
  if (scope.all) return true;
  return scope.departmentIds.includes(departmentId);
}

/**
 * Departments visible to a user in scope order — with the manager flag so
 * workspace surfaces (پشتیبانی / فایل‌های مشترک) can show real ownership.
 */
export async function listDepartmentsInScope(userId: string) {
  const scope = await resolveDepartmentScope(userId);

  const where = scope.all
    ? { isActive: true }
    : { isActive: true, id: { in: scope.departmentIds } };

  const departments = await db.department.findMany({
    where,
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      iconKey: true,
      welcomeMessage: true,
      aiEnabled: true,
      isPublic: true,
      memberships: {
        select: { userId: true, isManager: true },
      },
    },
  });

  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    iconKey: d.iconKey,
    welcomeMessage: d.welcomeMessage,
    aiEnabled: d.aiEnabled,
    isPublic: d.isPublic,
    isManager: d.memberships.some(
      (m) => m.userId === userId && m.isManager
    ),
  }));
}

/** Count of ACTIVE memberships per department — used by management UI. */
export async function countDepartmentMembers(): Promise<Map<string, number>> {
  const rows = await db.departmentMembership.groupBy({
    by: ["departmentId"],
    _count: { departmentId: true },
  });
  return new Map(rows.map((r) => [r.departmentId, r._count.departmentId]));
}
