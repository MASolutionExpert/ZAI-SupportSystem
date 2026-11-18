"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Force a server re-render to refresh the measured health snapshot. */
export function HealthRefreshButton({ pending }: { pending?: boolean }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.location.reload()}
      disabled={pending}
      aria-label="به‌روزرسانی وضعیت"
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      به‌روزرسانی
    </Button>
  );
}
