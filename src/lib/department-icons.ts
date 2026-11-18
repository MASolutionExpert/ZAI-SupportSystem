import {
  GraduationCap,
  Users,
  Wallet,
  LifeBuoy,
  Building2,
  MessageCircle,
  FileText,
  HelpCircle,
  Landmark,
  Package,
  Scale,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

/**
 * Client-safe department icon whitelist (no DB imports).
 * The server module `@/lib/departments` re-exports this for server components.
 */

export const DEPARTMENT_ICON_MAP: Record<string, LucideIcon> = {
  GraduationCap,
  Users,
  Wallet,
  LifeBuoy,
  Building2,
  MessageCircle,
  FileText,
  HelpCircle,
  Landmark,
  Package,
  Scale,
  Stethoscope,
};

export const DEPARTMENT_ICON_KEYS = Object.keys(DEPARTMENT_ICON_MAP);

export function getDepartmentIcon(iconKey: string): LucideIcon {
  return DEPARTMENT_ICON_MAP[iconKey] ?? MessageCircle;
}
