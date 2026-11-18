import "server-only";

import { db } from "@/lib/db";

/**
 * RAG Engine — access-scope resolution (task §8: isolation at the retrieval
 * layer). The authorized collection id set is computed from the KB model:
 *   GLOBAL            → visible to every department
 *   DEPARTMENT        → visible only with an explicit grant row
 *   RESTRICTED        → NEVER retrievable by the assistant (admin-only curation)
 * Inactive collections drop out regardless of access level.
 */

export async function authorizedCollectionIds(departmentId: string): Promise<string[]> {
  const collections = await db.knowledgeCollection.findMany({
    where: {
      isActive: true,
      OR: [
        { access: "GLOBAL" },
        {
          access: "DEPARTMENT",
          departmentGrants: { some: { departmentId } },
        },
      ],
    },
    select: { id: true },
  });
  return collections.map((collection) => collection.id);
}
