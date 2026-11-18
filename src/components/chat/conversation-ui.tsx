"use client";

import {
  CheckCircle2,
  Clock3,
  Headset,
  Sparkles,
  UserRoundCog,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { faDateTimeFormat, faNum } from "@/lib/format";
import type { ConversationMode, TranscriptMessage } from "@/lib/conversations/types";

export type { ConversationMode, TranscriptMessage };

/**
 * Conversation modes in which the customer transcript is polled for operator
 * replies (public chat side).
 */
export const OPERATOR_POLL_MODES: readonly ConversationMode[] = [
  "WAITING_FOR_OPERATOR",
  "ASSIGNED_TO_OPERATOR",
  "HUMAN_ACTIVE",
];

const MODE_BADGE_STYLES: Record<
  ConversationMode,
  { variant: "secondary" | "outline"; className?: string; icon: React.ReactNode }
> = {
  AI_ASSISTED: {
    variant: "secondary",
    icon: <Sparkles className="h-3 w-3" aria-hidden="true" />,
  },
  WAITING_FOR_OPERATOR: {
    variant: "outline",
    className: "border-amber-200 text-amber-700",
    icon: <Clock3 className="h-3 w-3" aria-hidden="true" />,
  },
  ASSIGNED_TO_OPERATOR: {
    variant: "outline",
    className: "border-amber-200 text-amber-700",
    icon: <UserRoundCog className="h-3 w-3" aria-hidden="true" />,
  },
  HUMAN_ACTIVE: {
    variant: "outline",
    className: "border-emerald-200 text-emerald-700",
    icon: <Headset className="h-3 w-3" aria-hidden="true" />,
  },
  RESOLVED: {
    variant: "outline",
    className: "text-muted-foreground",
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  },
};

/** Mode chip shared by the public chat dialog and the operator inbox. */
export function ModeBadge({ mode, label }: { mode: ConversationMode; label: string }) {
  const style = MODE_BADGE_STYLES[mode];
  return (
    <Badge variant={style.variant} className={cn("gap-1 font-normal", style.className)}>
      {style.icon}
      {label}
    </Badge>
  );
}

/**
 * One transcript entry. CUSTOMER bubbles sit on the inline-end edge
 * (visually left in RTL), ASSISTANT/OPERATOR on the inline-start edge,
 * SYSTEM messages are centered muted notes.
 */
export function TranscriptBubble({ message }: { message: TranscriptMessage }) {
  const { role, content, sourcesCount, createdAt } = message;

  if (role === "SYSTEM") {
    return (
      <p className="max-w-full self-center px-2 py-1 text-center text-xs leading-5 text-muted-foreground">
        {content}
      </p>
    );
  }

  const isCustomer = role === "CUSTOMER";

  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col gap-0.5",
        isCustomer ? "items-end self-end" : "items-start self-start"
      )}
    >
      <div
        className={cn(
          "whitespace-pre-wrap break-words px-3.5 py-2 text-sm leading-6",
          isCustomer
            ? "rounded-2xl rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-2xl rounded-tl-sm bg-muted text-foreground"
        )}
      >
        {content}
      </div>
      {role === "ASSISTANT" && sourcesCount !== null && sourcesCount > 0 ? (
        <span className="text-[10px] leading-4 text-muted-foreground">
          بر اساس {faNum(sourcesCount)} منبع تأییدشده
        </span>
      ) : null}
      <span className="text-[10px] leading-4 text-muted-foreground/80">
        {faDateTimeFormat(createdAt)}
      </span>
    </div>
  );
}

/** Three bouncing dots shown while an assistant turn is in flight. */
export function TypingIndicator() {
  return (
    <div
      role="status"
      aria-label="دستیار در حال نوشتن پاسخ است"
      className="flex items-center gap-1 self-start rounded-2xl rounded-tl-sm bg-muted px-3.5 py-3"
    >
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70"
          style={{ animationDelay: `${delay}ms` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
