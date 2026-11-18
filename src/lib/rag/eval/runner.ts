import "server-only";

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { writeKbFile, deleteKbFile, kbStorageRelativePath } from "@/lib/kb/store";
import { ingestDocumentNow, SYSTEM_INGEST_ACTOR } from "@/lib/rag/ingest/pipeline";
import { answer } from "@/lib/rag/engine";
import { sha256Hex } from "@/lib/crypto";
import {
  checkAnswer,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  summarizeLatency,
  type AnswerCheckResult,
} from "./metrics";
import { EVAL_CASES, EVAL_DATASET_ID, type EvalCase } from "./dataset";
import type { RagResult } from "@/lib/rag/types";

/**
 * RAG Engine — evaluation runner (task §10, acceptance §13.12).
 *
 * Reproducible procedure against the CURRENT database:
 *   1. verify the demo knowledge base exists (clear setup error otherwise);
 *   2. provision scenario fixtures (conflict pair, superseded authority,
 *      restricted isolation doc) — tagged, cleaned up afterwards;
 *   3. resolve gold evidence sets by human-readable fragments;
 *   4. execute every case through the real engine;
 *   5. compute retrieval + answer metrics, persist a RagEvalRun, print the
 *      report, clean up fixtures.
 *
 * The run is honest by construction: every failure lists its reason, and the
 * report distinguishes retrieval failure from answer-policy failure.
 */

const EVAL_TAG = "eval-fixture";

// ------------------------------------------------------------ fixture docs --

const FIXTURE_CONFLICT_A = `مصوبه جاری هزینه کارت

بخش هزینه‌ها
هزینه صدور کارت عضویت بر اساس مصوبه جدید هیئت‌مدیره ۵۰,۰۰۰ تومان است. این مصوبه از تاریخ ۱۴۰۳/۰۱/۰۱ ملاک عمل است و تمام مصوبات قبلی در این زمینه لغو می‌شود.`;

const FIXTURE_CONFLICT_B = `مصوبه قدیمی هزینه کارت

بخش هزینه‌ها
هزینه صدور کارت عضویت ۲۰,۰۰۰ تومان است.`;

const FIXTURE_SUPERSEDED = `مصوبه منقضی تخفیف کارت

بخش تخفیف‌ها
دارندگان عضویت طلایی تا پایان ۱۴۰۲ از تخفیف ۵۰ درصدی هزینه صدور کارت بهره‌مند می‌شوند.`;

const FIXTURE_ISOLATION = `دستورالعمل محرمانه پورسانت

بخش محاسبه
ضریب محرمانه محاسبه پورسانت فروش برابر ۰٫۱۸ است. این سند فقط برای دپارتمان مالی است.`;

const FIXTURE_EXACT_TERM = `آیین‌نامه عضویت (ارزیابی)

بخش مدارک
طبق بند ۱۲۳ متقاضی عضویت باید فرم درخواست، تصویر کارت ملی و یک قطعه عکس جدید را ارائه کند. بند ۱۲۳ در تمامی شعب بدون استثناء اجرا می‌شود.

بخش پرداخت
کد پیگیری صدور کارت FR-2214 برای امور مالی است.`;

type FixtureDoc = { title: string; text: string; collectionId: string; validUntil?: Date };

async function provisionFixtures(departmentId: string): Promise<Record<string, string>> {
  const collection = await db.knowledgeCollection.findFirst({
    where: { isActive: true, access: "GLOBAL" },
    select: { id: true },
  });
  if (!collection) throw new Error("مجموعه دانش جهانی برای نصب داده ارزیابی یافت نشد.");

  // Membership-scoped grant collection for the isolation fixture.
  const membershipDept = await db.department.findFirst({
    where: { name: { contains: "عضویت" } },
    select: { id: true },
  });
  let scopedCollectionId = collection.id;
  if (membershipDept) {
    const existing = await db.knowledgeCollection.findFirst({
      where: { name: EVAL_TAG + "-scoped", isActive: true },
      select: { id: true },
    });
    if (existing) {
      scopedCollectionId = existing.id;
    } else {
      const created = await db.knowledgeCollection.create({
        data: {
          name: EVAL_TAG + "-scoped",
          description: "مجموعه ارزیابی (دپارتمانی)",
          access: "DEPARTMENT",
          isActive: true,
          departmentGrants: { create: [{ departmentId: membershipDept.id }] },
        },
        select: { id: true },
      });
      scopedCollectionId = created.id;
    }
  }

  const fixtures: FixtureDoc[] = [
    { title: "مصوبه جاری هزینه کارت", text: FIXTURE_CONFLICT_A, collectionId: collection.id },
    { title: "مصوبه قدیمی هزینه کارت", text: FIXTURE_CONFLICT_B, collectionId: collection.id },
    {
      title: "مصوبه منقضی تخفیف کارت",
      text: FIXTURE_SUPERSEDED,
      collectionId: collection.id,
      validUntil: new Date(Date.now() - 24 * 3600 * 1000), // expired yesterday
    },
    { title: "آیین‌نامه عضویت (ارزیابی)", text: FIXTURE_EXACT_TERM, collectionId: collection.id },
    { title: "دستورالعمل محرمانه پورسانت", text: FIXTURE_ISOLATION, collectionId: scopedCollectionId },
  ];

  const ids: Record<string, string> = {};
  for (const fixture of fixtures) {
    const existing = await db.knowledgeDocument.findFirst({
      where: { title: fixture.title },
      select: { id: true },
    });
    if (existing) {
      ids[fixture.title] = existing.id;
      continue;
    }
    const documentId = randomUUID();
    const buffer = Buffer.from(fixture.text, "utf8");
    const checksum = sha256Hex(buffer);
    const storageKey = kbStorageRelativePath(`${EVAL_TAG}.txt`, documentId, "text/plain");
    await writeKbFile(buffer, storageKey);
    await db.knowledgeDocument.create({
      data: {
        id: documentId,
        collectionId: fixture.collectionId,
        title: fixture.title,
        originalFilename: `${EVAL_TAG}.txt`,
        mimeType: "text/plain",
        sizeBytes: buffer.length,
        checksum,
        storageKey,
        status: "UPLOADED",
        uploadedBy: await systemActorUserId(),
        validUntil: fixture.validUntil ?? null,
        versions: {
          create: {
            versionNo: 1,
            storageKey,
            mimeType: "text/plain",
            sizeBytes: buffer.length,
            checksum,
            uploadedBy: await systemActorUserId(),
          },
        },
      },
      select: { id: true },
    });
    const outcome = await ingestDocumentNow(documentId, SYSTEM_INGEST_ACTOR);
    if (outcome.status !== "INDEXED") {
      throw new Error(`نصب سند ارزیابی «${fixture.title}» ناموفق بود: ${outcome.error ?? ""}`);
    }
    ids[fixture.title] = documentId;
  }
  return ids;
}

async function cleanupFixtures(fixtures: Record<string, string>): Promise<void> {
  for (const documentId of Object.values(fixtures)) {
    const document = await db.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: { storageKey: true, versions: { select: { storageKey: true } } },
    });
    if (!document) continue;
    await db.knowledgeDocument.delete({ where: { id: documentId } });
    const keys = new Set([document.storageKey, ...document.versions.map((v) => v.storageKey)]);
    for (const key of keys) await deleteKbFile(key);
  }
  await db.knowledgeCollection.deleteMany({ where: { name: EVAL_TAG + "-scoped" } });
}

async function systemActorUserId(): Promise<string> {
  const admin = await db.user.findFirst({ where: { roleKey: "SUPER_ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("کاربر مدیر ارشد برای داده ارزیابی یافت نشد.");
  return admin.id;
}

// ------------------------------------------------------------- gold resolve --

async function resolveDepartment(key: EvalCase["department"]): Promise<{ id: string; name: string }> {
  const names: Record<EvalCase["department"], string> = {
    training: "آموزش",
    membership: "عضویت",
    finance: "مالی",
    tech: "پشتیبانی فنی",
  };
  const department = await db.department.findFirst({
    where: { name: { contains: names[key] }, isActive: true },
    select: { id: true, name: true },
  });
  if (!department) throw new Error(`دپارتمان دمو «${names[key]}» یافت نشد — ابتدا bun run seed-demo را اجرا کنید.`);
  return department;
}

// ------------------------------------------------------------------ runner --

export type EvalCaseResult = {
  caseId: string;
  kind: string;
  status: string;
  passed: boolean;
  /** true when the model provider was unavailable (heuristic-only mode). */
  degraded: boolean;
  retrieval: { recallAt5: number; precisionAt5: number; mrr: number; ndcgAt5: number; goldCount: number; latencyMs: number };
  answerChecks: AnswerCheckResult;
  failures: string[];
};

export type EvalReport = {
  datasetId: string;
  total: number;
  passed: number;
  failed: number;
  /** Cases that ran heuristic-only because the model provider was unavailable. */
  degradedCount: number;
  retrievalAggregate: {
    recallAt5: number;
    precisionAt5: number;
    mrr: number;
    ndcgAt5: number;
    latency: { avg: number; p50: number; p95: number; max: number };
  };
  results: EvalCaseResult[];
};

export async function runAcceptanceEvaluation(options?: { cleanupFixturesAfter?: boolean }): Promise<EvalReport> {
  const cleanupAfter = options?.cleanupFixturesAfter ?? true;
  const departmentCache = new Map<EvalCase["department"], { id: string; name: string }>();
  const results: EvalCaseResult[] = [];
  const latencySamples: number[] = [];
  const recallSamples: number[] = [];
  const precisionSamples: number[] = [];
  const mrrSamples: number[] = [];
  const ndcgSamples: number[] = [];

  const fixtures = await provisionFixtures((await resolveDepartment("membership")).id);
  let runError: string | null = null;

  try {
    for (const evalCase of EVAL_CASES) {
      // Rate-limit-friendly pacing: the builtin provider throttles bursts.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const department =
        departmentCache.get(evalCase.department) ?? (await resolveDepartment(evalCase.department));
      departmentCache.set(evalCase.department, department);

      const started = Date.now();
      let result: RagResult;
      try {
        result = await answer({
          scope: { departmentId: department.id },
          departmentName: department.name,
          question: evalCase.question,
          history: [],
          minConfidence: 0.35,
          escalationOffer: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          caseId: evalCase.id,
          kind: evalCase.kind,
          status: "ERROR",
          passed: false,
          degraded: false,
          retrieval: { recallAt5: 0, precisionAt5: 0, mrr: 0, ndcgAt5: 0, goldCount: 0, latencyMs: Date.now() - started },
          answerChecks: { passed: false, abstentionCorrect: false, citationsValid: false, keywordSupported: false, failures: [message] },
          failures: [`خطای موتور: ${message}`],
        });
        continue;
      }
      const latencyMs = Date.now() - started;
      latencySamples.push(latencyMs);
      // Degraded mode: the provider answered nothing (throttle/outage) and
      // the engine ran heuristic-only. Such cases measure resilience, not
      // answer quality — reported separately, never silently passed.
      const degraded = result.trace.llmCalls === 0;

      // Retrieval metrics over the evidence the engine actually surfaced.
      // Gold keys: QA refs → Q&A entry ids; DOC refs → DOCUMENT ids (finding
      // any chunk of the right document counts — chunk-level gold was
      // over-strict). Ranked keys are deduplicated in rank order.
      const goldKeys = new Set<string>();
      for (const ref of evalCase.expect.gold ?? []) {
        if (ref.kind === "QA") {
          const entries = await db.knowledgeQaEntry.findMany({
            where: { question: { contains: ref.questionIncludes }, status: "PUBLISHED" },
            select: { id: true },
          });
          entries.forEach((entry) => goldKeys.add(entry.id));
        } else {
          const document = await db.knowledgeDocument.findFirst({
            where: { title: { contains: ref.titleIncludes } },
            select: { id: true },
          });
          if (document) goldKeys.add(document.id);
        }
      }
      const rankedIds: string[] = [];
      for (const evidence of result.evidence) {
        const key = evidence.kind === "QA" ? evidence.qaId ?? evidence.id : evidence.documentId ?? evidence.id;
        if (key && !rankedIds.includes(key)) rankedIds.push(key);
      }
      const evidenceChunkIds = result.evidence.map((e) => e.id);
      const recall = goldKeys.size > 0 ? recallAtK(rankedIds, goldKeys, 5) : 1;
      const precision = precisionAtK(rankedIds, goldKeys, 5);
      const mrr = reciprocalRank(rankedIds, goldKeys);
      const ndcg = ndcgAtK(rankedIds, goldKeys, 5);
      recallSamples.push(recall);
      precisionSamples.push(precision);
      mrrSamples.push(mrr);
      ndcgSamples.push(ndcg);

      const answerChecks = checkAnswer({
        expectedStatus: evalCase.expect.status,
        actualStatus: result.status,
        answerText: result.answerText,
        citations: result.citations,
        retrievedIds: evidenceChunkIds,
        mustCite: evalCase.expect.mustCite,
        mustContainAny: evalCase.expect.mustContainAny,
      });

      // Department isolation case additionally verifies the restricted doc's
      // content words NEVER appear in the answer.
      if (evalCase.kind === "dept-scoped") {
        const leaked = result.answerText.includes("۰٫۱۸") || result.answerText.includes("پورسانت");
        if (leaked) {
          answerChecks.passed = false;
          answerChecks.failures.push("نشت محتوای سند محرمانه در پاسخ!");
        }
      }

      // Conflict / supersession expectations (criteria 6 and 7).
      if (evalCase.expect.expectConflict && !result.conflictDetected) {
        answerChecks.passed = false;
        answerChecks.failures.push("تعارض مدارک شناسایی نشد (conflictDetected=false).");
      }
      if (evalCase.expect.expectSuperseded && !result.trace.supersededExcluded) {
        answerChecks.passed = false;
        answerChecks.failures.push("سند منقضی از بازیابی حذف نشد (supersededExcluded=false).");
      }

      results.push({
        caseId: evalCase.id,
        kind: evalCase.kind,
        status: result.status,
        degraded,
        // Kind-aware gating: for superseded/isolation scenarios the gold doc
        // is *supposed* to be unreachable — recall is asserted inverted (or
        // not at all); answer status + flags carry the assertion instead.
        passed:
          answerChecks.passed &&
          (evalCase.kind === "superseded" || evalCase.kind === "dept-scoped"
            ? true
            : goldKeys.size === 0
              ? true
              : recall > 0),
        retrieval: {
          recallAt5: Number(recall.toFixed(3)),
          precisionAt5: Number(precision.toFixed(3)),
          mrr: Number(mrr.toFixed(3)),
          ndcgAt5: Number(ndcg.toFixed(3)),
          goldCount: goldKeys.size,
          latencyMs,
        },
        answerChecks,
        failures: answerChecks.failures,
      });
    }

    // Acceptance 11 — reindex integrity (unit-style check inside the run).
    results.push(await reindexIntegrityCheck());
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
  } finally {
    if (cleanupAfter) await cleanupFixtures(fixtures).catch(() => undefined);
  }

  const degradedCount = results.filter((r) => r.degraded).length;
  const passed = results.filter((r) => r.passed && !r.degraded).length;
  const report: EvalReport = {
    datasetId: EVAL_DATASET_ID,
    total: results.length,
    passed,
    failed: results.length - passed - degradedCount,
    degradedCount,
    retrievalAggregate: {
      recallAt5: mean(recallSamples),
      precisionAt5: mean(precisionSamples),
      mrr: mean(mrrSamples),
      ndcgAt5: mean(ndcgSamples),
      latency: summarizeLatency(latencySamples),
    },
    results,
  };

  const { getAppVersion } = await import("@/lib/version");
  const version = await getAppVersion();
  await db.ragEvalRun.create({
    data: {
      datasetId: EVAL_DATASET_ID,
      engineVersion: version,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      metricsJson: JSON.stringify(report.retrievalAggregate),
      resultsJson: JSON.stringify({ results: report.results, runError }),
      durationMs: latencySamples.reduce((a, b) => a + b, 0),
    },
  });

  await audit({
    actorType: "SYSTEM",
    action: "rag.eval.run",
    entityType: "RagEvalRun",
    metadata: { datasetId: EVAL_DATASET_ID, passed: report.passed, failed: report.failed, runError },
  });

  return report;
}

function mean(samples: number[]): number {
  if (samples.length === 0) return 0;
  return Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3));
}

/** Acceptance 11: replace a document → no stale/duplicate chunks remain. */
async function reindexIntegrityCheck(): Promise<EvalCaseResult> {
  const started = Date.now();
  const failures: string[] = [];
  try {
    const collection = await db.knowledgeCollection.findFirst({
      where: { isActive: true, access: "GLOBAL" },
      select: { id: true },
    });
    if (!collection) throw new Error("مجموعه جهانی یافت نشد.");

    const documentId = randomUUID();
    const v1 = Buffer.from("نسخه یک متن ارزیابی بازفهرست‌سازی\n\nعلامت یکتای نسخه اول: SIGMA-ALPHA-1", "utf8");
    const storageKey = kbStorageRelativePath("reindex-eval.txt", documentId, "text/plain");
    await writeKbFile(v1, storageKey);
    await db.knowledgeDocument.create({
      data: {
        id: documentId,
        collectionId: collection.id,
        title: "سند ارزیابی بازفهرست‌سازی",
        originalFilename: "reindex-eval.txt",
        mimeType: "text/plain",
        sizeBytes: v1.length,
        checksum: sha256Hex(v1),
        storageKey,
        status: "UPLOADED",
        uploadedBy: await systemActorUserId(),
        versions: {
          create: {
            versionNo: 1,
            storageKey,
            mimeType: "text/plain",
            sizeBytes: v1.length,
            checksum: sha256Hex(v1),
            uploadedBy: await systemActorUserId(),
          },
        },
      },
      select: { id: true },
    });

    const first = await ingestDocumentNow(documentId, SYSTEM_INGEST_ACTOR);
    const v1Count = await db.knowledgeChunk.count({ where: { documentId } });

    // Replace content (same document, new version) with different text.
    const v2 = Buffer.from("نسخه دو متن ارزیابی بازفهرست‌سازی\n\nعلامت یکتای نسخه دوم: SIGMA-BETA-2", "utf8");
    const v2Key = kbStorageRelativePath("reindex-eval.txt", documentId + "-v2", "text/plain");
    await writeKbFile(v2, v2Key);
    const nextVersionNo = 2;
    await db.knowledgeDocumentVersion.create({
      data: {
        documentId,
        versionNo: nextVersionNo,
        storageKey: v2Key,
        mimeType: "text/plain",
        sizeBytes: v2.length,
        checksum: sha256Hex(v2),
        uploadedBy: await systemActorUserId(),
      },
    });
    await db.knowledgeDocument.update({
      where: { id: documentId },
      data: { storageKey: v2Key, checksum: sha256Hex(v2), sizeBytes: v2.length },
    });
    const second = await ingestDocumentNow(documentId, SYSTEM_INGEST_ACTOR);

    const stale = await db.knowledgeChunk.count({
      where: { documentId, text: { contains: "SIGMA-ALPHA-1" } },
    });
    const current = await db.knowledgeChunk.count({ where: { documentId } });
    const duplicates = await db.knowledgeChunk.groupBy({
      by: ["ordinal"],
      where: { documentId },
      _count: { ordinal: true },
    });
    const dupes = duplicates.filter((d) => d._count.ordinal > 1).length;

    if (first.status !== "INDEXED" || second.status !== "INDEXED") {
      failures.push("بازفهرست‌سازی ناموفق بود.");
    }
    if (stale > 0) failures.push("قطعه‌های نسخه قدیمی باقی مانده‌اند (stale).");
    if (dupes > 0) failures.push("قطعه تکراری (ordinal تکراری) یافت شد.");
    if (v1Count === 0 || current === 0) failures.push("هیچ قطعه‌ای فهرست نشد.");

    await db.knowledgeDocument.delete({ where: { id: documentId } });
    await deleteKbFile(storageKey);
    await deleteKbFile(v2Key);

    return {
      caseId: "ac11-reindex-integrity",
      kind: "reindex-integrity",
      status: failures.length === 0 ? "ANSWERED" : "ABSTAIN",
      passed: failures.length === 0,
      degraded: false,
      retrieval: { recallAt5: 0, precisionAt5: 0, mrr: 0, ndcgAt5: 0, goldCount: 0, latencyMs: Date.now() - started },
      answerChecks: { passed: failures.length === 0, abstentionCorrect: true, citationsValid: true, keywordSupported: true, failures },
      failures,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      caseId: "ac11-reindex-integrity",
      kind: "reindex-integrity",
      status: "ERROR",
      passed: false,
      degraded: false,
      retrieval: { recallAt5: 0, precisionAt5: 0, mrr: 0, ndcgAt5: 0, goldCount: 0, latencyMs: Date.now() - started },
      answerChecks: { passed: false, abstentionCorrect: false, citationsValid: false, keywordSupported: false, failures: [message] },
      failures: [message],
    };
  }
}
