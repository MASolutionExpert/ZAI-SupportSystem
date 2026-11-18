/**
 * Debug — run one question through the RAG engine and print the full trace.
 * Usage: bun --conditions=react-server scripts/debug-rag.ts "<question>" [departmentId]
 */

export {};

async function main() {
  const question = process.argv[2] ?? "ساعات کاری دپارتمان آموزش چیست؟";
  const { db } = await import("../src/lib/db");
  const { answer } = await import("../src/lib/rag/engine");

  const dept = process.argv[3]
    ? { id: process.argv[3], name: "دپارتمان آزمایشی" }
    : await db.department.findFirst({ where: { aiEnabled: true }, select: { id: true, name: true } });
  if (!dept) throw new Error("no department");

  console.log("department:", dept.id, dept.name);
  const result = await answer({
    scope: { departmentId: dept.id },
    departmentName: dept.name,
    question,
    history: [],
    minConfidence: 0.35,
    escalationOffer: true,
  });

  console.log("=== RESULT ===");
  console.log("status:", result.status, "| strategy:", result.strategy, "| confidence:", result.confidence.toFixed(3));
  console.log("trace:", JSON.stringify(result.trace, null, 1).slice(0, 2000));
  console.log("evidence:", JSON.stringify(result.evidence.map((e) => ({ kind: e.kind, score: +e.score.toFixed(3), lexical: +e.lexicalScore.toFixed(3), semantic: e.semanticScore, qa: e.qaQuestion ?? undefined, title: e.documentTitle })), null, 1).slice(0, 900));
  console.log("trace.strategy:", result.trace.strategy, "| iterations:", JSON.stringify(result.trace.iterations));
  console.log("citations:", result.citations);
  console.log("answer:", result.answerText.slice(0, 500));

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
