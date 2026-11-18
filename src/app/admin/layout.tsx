import { StaffShell } from "@/components/shell/staff-shell";

export const metadata = { title: "محیط کارکنان" };

/**
 * Admin area layout — real server-side authorization:
 *  - no valid session → /login
 *  - forced password change → /change-password
 *  - dashboard shell requires `admin.dashboard.view` (deny-by-default)
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StaffShell permission="admin.dashboard.view" workspace="admin">
      {children}
    </StaffShell>
  );
}
