import { ShieldAlert } from "lucide-react";

/** Shared access-denied panel for permission-gated admin pages. */
export function AccessDenied({ title = "دسترسی ندارید" }: { title?: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center space-y-2 max-w-md">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          حساب شما مجوز لازم برای این بخش را ندارد. برای دریافت دسترسی با مدیر سامانه تماس بگیرید.
        </p>
      </div>
    </div>
  );
}
