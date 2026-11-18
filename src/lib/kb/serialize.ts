/**
 * Knowledge Base — serializers for API responses (JSON string columns are
 * parsed safely; relation rows are flattened).
 */

import type { KnowledgeQaAlternate, KnowledgeQaDepartment, User } from "@prisma/client";

type QaEntryWithRelations = {
  id: string;
  question: string;
  officialAnswer: string;
  category: string | null;
  keywords: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: Pick<User, "name">;
  alternates: Pick<KnowledgeQaAlternate, "id" | "question">[];
  departments: { department: { id: string; name: string } }[];
};

/** Safely parse a JSON string column that should hold an array of strings. */
function safeParseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** Flattened Q&A entry shape used by list + detail endpoints. */
export function serializeQaEntry(entry: QaEntryWithRelations) {
  return {
    id: entry.id,
    question: entry.question,
    officialAnswer: entry.officialAnswer,
    category: entry.category,
    keywords: safeParseStringArray(entry.keywords),
    status: entry.status,
    alternates: entry.alternates.map((alternate) => alternate.question),
    departments: entry.departments.map((assignment) => ({
      id: assignment.department.id,
      name: assignment.department.name,
    })),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    createdByName: entry.createdBy.name,
  };
}
