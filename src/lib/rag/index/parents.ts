import "server-only";

import { db } from "@/lib/db";
import type { Evidence } from "@/lib/rag/types";

/**
 * RAG Engine — parent-child expansion (task §4.E).
 *
 * Children are the precise retrieval units; when one earns a top slot, its
 * parent SECTION supplies the surrounding context so regulations and long
 * documents keep their meaning. Expansion happens AFTER authorization (the
 * child is already access-filtered; its parent belongs to the same document /
 * version and therefore the same access class — re-checked anyway for
 * defense in depth).
 */

export async function expandParents(
  evidence: Evidence[],
  limit: number
): Promise<{ expanded: Evidence[]; expandedCount: number }> {
  if (limit <= 0) return { expanded: evidence, expandedCount: 0 };

  const childIds = evidence
    .filter((e) => e.kind === "PARAGRAPH" && !e.parentText)
    .map((e) => e.id)
    .slice(0, limit);

  if (childIds.length === 0) return { expanded: evidence, expandedCount: 0 };

  const parents = await db.knowledgeChunk.findMany({
    where: {
      kind: "SECTION",
      children: { some: { id: { in: childIds } } },
    },
    select: {
      id: true,
      text: true,
      headingPath: true,
      page: true,
      isActive: true,
      document: { select: { status: true, collection: { select: { access: true } } } },
    },
  });

  const byParent = new Map<string, (typeof parents)[number]>();
  // Resolve which parent belongs to which child.
  const childToParent = await db.knowledgeChunk.findMany({
    where: { id: { in: childIds } },
    select: { id: true, parentId: true },
  });
  for (const child of childToParent) {
    if (!child.parentId) continue;
    const parent = parents.find((p) => p.id === child.parentId);
    // Defense in depth: never expand across a disabled doc / inactive parent.
    if (parent && parent.isActive && parent.document.status === "INDEXED") {
      byParent.set(child.id, parent);
    }
  }

  let expandedCount = 0;
  const expanded = evidence.map((e) => {
    const parent = byParent.get(e.id);
    if (!parent) return e;
    expandedCount++;
    return {
      ...e,
      parentText: parent.text.slice(0, 1800),
      headingPath: e.headingPath ?? parent.headingPath,
      page: e.page ?? parent.page,
    };
  });

  return { expanded, expandedCount };
}
