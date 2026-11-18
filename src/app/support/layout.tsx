import { StaffShell } from "@/components/shell/staff-shell";

export const metadata = { title: "میز پشتیبانی" };

/** Support workspace — gated by `tickets.view` (OPERATOR/SUPER_ADMIN baseline). */
export default function SupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StaffShell permission="tickets.view" workspace="support">
      {children}
    </StaffShell>
  );
}
