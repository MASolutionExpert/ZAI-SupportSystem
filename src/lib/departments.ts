import { db } from "@/lib/db";

/**
 * Department queries — the landing page renders departments straight from the
 * database — creating and activating a department in the admin panel makes it
 * appear here with no code change or redeployment (master spec 3.1).
 */

export {
  DEPARTMENT_ICON_MAP,
  DEPARTMENT_ICON_KEYS,
  getDepartmentIcon,
} from "@/lib/department-icons";

export type PublicDepartment = {
  id: string;
  name: string;
  description: string | null;
  iconKey: string;
  welcomeMessage: string | null;
  aiEnabled: boolean;
};

/** Departments visible on the public landing page, in display order. */
export async function listPublicDepartments(): Promise<PublicDepartment[]> {
  const rows = await db.department.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      iconKey: true,
      welcomeMessage: true,
      aiEnabled: true,
    },
  });
  return rows;
}
