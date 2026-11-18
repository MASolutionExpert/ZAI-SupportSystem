/**
 * Conversations — shared domain types and Persian labels (Phase 3).
 *
 * Schema convention: `Conversation.mode` and
 * `ConversationMessage.role` are plain strings validated by these unions at
 * the application layer (mirrors the KB/AI convention).
 */

export const CONVERSATION_MODES = [
  "AI_ASSISTED",
  "WAITING_FOR_OPERATOR",
  "ASSIGNED_TO_OPERATOR",
  "HUMAN_ACTIVE",
  "RESOLVED",
] as const;

export type ConversationMode = typeof CONVERSATION_MODES[number];

export const CONVERSATION_MODE_LABELS: Record<ConversationMode, string> = {
  AI_ASSISTED: "گفتگو با دستیار هوشمند",
  WAITING_FOR_OPERATOR: "در انتظار اپراتور",
  ASSIGNED_TO_OPERATOR: "ارجاع‌شده به اپراتور",
  HUMAN_ACTIVE: "گفتگو با اپراتور",
  RESOLVED: "پایان‌یافته",
};

export const MESSAGE_ROLES = ["CUSTOMER", "ASSISTANT", "OPERATOR", "SYSTEM"] as const;

export type MessageRole = typeof MESSAGE_ROLES[number];

/** Client-facing transcript entry — never leaks internal source metadata. */
export type TranscriptMessage = {
  id: string;
  role: MessageRole;
  content: string;
  sourcesCount: number | null;
  createdAt: string;
};
