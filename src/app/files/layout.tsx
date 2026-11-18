import { StaffShell } from "@/components/shell/staff-shell";

export const metadata = { title: "فایل‌های مشترک" };

/** Shared file hub workspace — gated by `files.access`. */
export default function FilesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StaffShell permission="files.access" workspace="files">
      {children}
    </StaffShell>
  );
}
