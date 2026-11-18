"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PublicChatDialog } from "@/components/chat/public-chat-dialog";

/**
 * Public department card — now a live-chat entry point (Phase 3).
 * Clicking the card (or its button) opens the customer chat dialog.
 * The resume token lives in the customer's localStorage, keyed per department.
 */
export function DepartmentCard({
  departmentId,
  name,
  description,
  welcomeMessage,
  aiEnabled,
  icon,
  delay = 0,
}: {
  departmentId: string;
  name: string;
  description: string | null;
  welcomeMessage: string | null;
  aiEnabled: boolean;
  icon: React.ReactNode;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="sd-fade-up group relative cursor-pointer overflow-hidden outline-offset-2 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary/60"
        style={{ animationDelay: `${delay}ms` }}
      >
        <CardContent className="flex h-full flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground transition-transform group-hover:scale-105">
              {icon}
            </span>
            <Badge variant="secondary">گفتگوی زنده</Badge>
          </div>

          <div className="flex-1 space-y-1.5">
            <h3 className="text-base font-semibold sm:text-lg">{name}</h3>
            <p className="min-h-6 text-sm leading-6 text-muted-foreground">
              {description ?? welcomeMessage ?? "پشتیبانی این دپارتمان آماده پاسخ‌گویی است."}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            {aiEnabled ? (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                دارای دستیار هوشمند
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden="true" />
                پاسخگویی توسط اپراتورها
              </span>
            )}
          </div>

          <div className="border-t pt-3">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
              }}
            >
              شروع گفتگو
            </Button>
          </div>
        </CardContent>
      </Card>

      <PublicChatDialog
        departmentId={departmentId}
        departmentName={name}
        aiEnabled={aiEnabled}
        welcomeMessage={welcomeMessage}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
