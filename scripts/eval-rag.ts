/**
 * RAG acceptance evaluation — `bun run rag:eval`.
 *
 * Runs the reproducible acceptance dataset through the live RAG engine
 * (direct engine call, dev server not required) against the current database.
 * Demo data must exist (`bun run bootstrap && bun run seed-demo`).
 */

export {};

async function main() {
  const { runAcceptanceEvaluation } = await import("../src/lib/rag/eval/runner");

  console.log("▶ Running RAG acceptance evaluation (acceptance-v1)…");
  const report = await runAcceptanceEvaluation();

  console.log("\n=== Retrieval aggregate ===");
  console.log(JSON.stringify(report.retrievalAggregate, null, 1));

  console.log("\n=== Per-case results ===");
  for (const result of report.results) {
    const mark = result.passed ? "✔" : "✖";
    console.log(
      `${mark} ${result.caseId} [${result.kind}] status=${result.status} ` +
        `recall@5=${result.retrieval.recallAt5} mrr=${result.retrieval.mrr} ` +
        `${result.retrieval.latencyMs}ms` +
        (result.failures.length > 0 ? ` — ${result.failures.join(" | ")}` : "")
    );
  }

  console.log(
    `\n=== Result: ${report.passed}/${report.total} PASS` +
      (report.degradedCount > 0 ? ` (${report.degradedCount} degraded — provider unavailable)` : "") +
      ` ===`
  );
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exit(1);
});
