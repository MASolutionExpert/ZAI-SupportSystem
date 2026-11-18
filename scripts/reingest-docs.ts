/**
 * Utility — re-ingest knowledge documents through the RAG engine pipeline.
 *
 * Usage:
 *   bun scripts/reingest-demo.ts            # every INDEXED/FAILED document
 *   bun scripts/reingest-demo.ts <docId>    # one document
 */

export {}; // module isolation

async function main() {
  const { db } = await import("../src/lib/db");
  const { ingestDocumentNow } = await import("../src/lib/rag/ingest/pipeline");
  const targetId = process.argv[2];

  const docs = await db.knowledgeDocument.findMany({
    where: targetId ? { id: targetId } : { status: { in: ["INDEXED", "FAILED", "UPLOADED"] } },
    select: { id: true, title: true },
  });

  if (docs.length === 0) {
    console.log("No documents to re-ingest.");
  }

  for (const doc of docs) {
    const outcome = await ingestDocumentNow(doc.id, { id: "system", label: "reingest-script" });
    console.log(
      `${outcome.status === "INDEXED" ? "✔" : "✖"} ${doc.title}: ${outcome.status}` +
        (outcome.status === "INDEXED"
          ? ` — ${outcome.chunks} chunks (${outcome.sections} sections + ${outcome.children} children), model ${outcome.embeddingModel}`
          : ` — ${outcome.error ?? ""}`)
    );
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error("Re-ingest failed:", error);
  process.exit(1);
});
