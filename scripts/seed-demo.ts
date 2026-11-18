/**
 * Explicit DEMO seed — `bun run seed-demo`.
 *
 * Master spec section 15: demo data must only be inserted through an explicit
 * development/demo process. This script:
 *   - refuses to run in production,
 *   - refuses to run when any department / knowledge collection / Q&A entry
 *     already exists (never mixes demo and real data, never overwrites),
 *   - validates every precondition (super admin, OPERATOR role) BEFORE the
 *     first write — a failed run must never leave a half-seeded database,
 *   - inserts demo departments, a demo knowledge collection, curated Q&A
 *     entries, one demo indexed document and two demo operators so the public
 *     landing page, the AI assistant pipeline and the operator inbox can be
 *     evaluated during development.
 *
 * Atomicity design (v0.10.1):
 *   1. All demo ROWS are inserted inside a single Prisma interactive
 *      transaction — any failure rolls the database back to its pre-seed
 *      state, so the "abort when data exists" guard stays satisfiable.
 *   2. Side effects that cannot join a transaction (storage file write, RAG
 *      ingestion) run AFTER commit; if they fail, a compensating cleanup
 *      removes every row created by the transaction and the storage file,
 *      restoring the pre-seed state.
 *
 * The demo document is inserted directly as UPLOADED and then ingested by the
 * real RAG pipeline (structure-aware chunks + hashed embeddings + provenance)
 * — deterministic demo content, NOT a pipeline bypass for real uploads; real
 * uploads always go through the extraction pipeline.
 */
import { shutdownCache } from "@/lib/cache";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";

// Note: bun auto-loads .env from the project root for scripts.
export {}; // ensure this file is a module (isolates it from other scripts)

const DEMO_DEPARTMENTS = [
  {
    name: "دپارتمان آموزش",
    description: "دوره‌ها، ثبت‌نام و پرسش‌های آموزشی",
    iconKey: "GraduationCap",
    displayOrder: 1,
    aiEnabled: true,
    welcomeMessage: "سلام! برای پرسش‌های آموزشی در خدمت شما هستیم.",
  },
  {
    name: "دپارتمان عضویت",
    description: "عضویت، کارت عضویت و امور اعضا",
    iconKey: "Users",
    displayOrder: 2,
    aiEnabled: true,
    welcomeMessage: "امور عضویت و کارت اعضا را این‌جا پیگیری کنید.",
  },
  {
    name: "دپارتمان مالی",
    description: "فوت، صورت‌حساب و امور مالی",
    iconKey: "Wallet",
    displayOrder: 3,
    aiEnabled: false,
    welcomeMessage: "واحد مالی پاسخگوی پرسش‌های پرداخت و صورت‌حساب است.",
  },
  {
    name: "پشتیبانی فنی",
    description: "خطاهای سامانه، ورود و مشکلات فنی",
    iconKey: "LifeBuoy",
    displayOrder: 4,
    aiEnabled: true,
    welcomeMessage: "اگر سامانه برای شما به‌درستی کار نمی‌کند، این‌جا اطلاع دهید.",
  },
];

type DemoState = {
  departmentIds: string[];
  collectionId: string;
  qaEntryIds: string[];
  documentId: string;
  storageKey: string;
  newOperatorIds: string[];
};

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED_ALLOWED !== "true") {
    console.error("✖ Refusing to seed demo data in production (NODE_ENV=production).");
    process.exit(1);
  }

  const { db } = await import("../src/lib/db");
  const { audit } = await import("../src/lib/audit");

  // ---------------------------------------------------------------------------
  // Pre-flight — every precondition is validated BEFORE the first write so a
  // failed run can never leave a half-seeded database behind.
  // ---------------------------------------------------------------------------
  const existing = await db.department.count();
  if (existing > 0) {
    console.error(
      `✖ ${existing} department(s) already exist — demo seed aborted to protect real data.`
    );
    await db.$disconnect();
    await shutdownCache();
    process.exit(1);
  }

  const existingCollections = await db.knowledgeCollection.count();
  const existingQa = await db.knowledgeQaEntry.count();
  if (existingCollections > 0 || existingQa > 0) {
    console.error(
      "✖ Knowledge Base content already exists — demo seed aborted to protect real data."
    );
    await db.$disconnect();
    await shutdownCache();
    process.exit(1);
  }

  const admin = await db.user.findFirst({
    where: { roleKey: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!admin) {
    console.error("✖ No SUPER_ADMIN exists — run `bun run bootstrap` first.");
    await db.$disconnect();
    await shutdownCache();
    process.exit(1);
  }
  const adminId = admin.id;

  const operatorRole = await db.role.findUnique({ where: { key: "OPERATOR" } });
  if (!operatorRole) {
    console.error("✖ OPERATOR role missing — run `bootstrap` first.");
    await db.$disconnect();
    await shutdownCache();
    process.exit(1);
  }

  // Deterministic pieces of the demo document (computed before the transaction
  // so the transaction body contains database work only).
  const demoDocTitle = "راهنمای عضویت سازمان";
  const demoDocText = `راهنمای عضویت سازمان

انواع عضویت
سازمان سه نوع عضویت دارد: عضویت عادی، عضویت طلایی و عضویت سازمانی. عضویت عادی شامل دسترسی به رویدادهای عمومی است. عضویت طلایی علاوه بر رویدادهای عمومی، شامل تخفیف دوره‌های آموزشی می‌شود.

تمدید عضویت
تمدید عضویت از ۱۰ روز پیش از تاریخ انقضا در پنل کاربری فعال می‌شود. اگر عضویت بیش از ۳۰ روز منقضی شود، باید فرم عضویت از نو تکمیل گردد.

لغو عضویت
درخواست لغو عضویت باید از طریق پنل کاربری ثبت شود و ظرف ۷ روز کاری بررسی می‌گردد. هزینه دوره‌های خریداری‌شده پس از لغو عضویت بازگشت داده نمی‌شود.`;
  const { createHash } = await import("crypto");
  const checksum = createHash("sha256").update(demoDocText).digest("hex");
  const docId = `demo-${Date.now().toString(36)}`;
  const storageKey = `kb/${docId}.txt`;
  const storageDir = process.env.STORAGE_DIR ?? "./storage";
  const storageRoot = path.isAbsolute(storageDir)
    ? storageDir
    : path.join(process.cwd(), storageDir);
  const absolutePath = path.join(storageRoot, storageKey);

  const bcrypt = await import("bcryptjs");
  const operatorPassword = await bcrypt.hash("Operator2026DemoX", 12);
  const demoOperatorNames = [
    { username: "operator1", name: "اپراتور نمونه یک" },
    { username: "operator2", name: "اپراتور نمونه دو" },
  ];

  // ---------------------------------------------------------------------------
  // Phase 1 — atomic demo dataset (single transaction; all rows or nothing).
  // ---------------------------------------------------------------------------
  console.log("▶ Seeding demo data (single atomic transaction)…");
  const state = await db.$transaction<DemoState>(
    async (tx) => {
      const departmentIds: string[] = [];
      for (const dept of DEMO_DEPARTMENTS) {
        const created = await tx.department.create({
          data: { ...dept, isActive: true, isPublic: true },
          select: { id: true },
        });
        departmentIds.push(created.id);
        console.log(`  + دپارتمان: ${dept.name}`);
      }

      const collection = await tx.knowledgeCollection.create({
        data: {
          name: "دانش پایه سازمان (دمو)",
          description: "مجموعه دانش عمومی سازمان برای ارزیابی دستیار هوشمند — داده دمو.",
          access: "GLOBAL",
          isActive: true,
        },
        select: { id: true },
      });
      console.log("  + دانش‌کده: دانش پایه سازمان (دمو)");

      const demoQaEntries = [
        {
          question: "ساعات کاری دپارتمان آموزش چیست؟",
          officialAnswer:
            "دپارتمان آموزش از شنبه تا چهارشنبه ساعت ۸ تا ۱۶ و پنجشنبه‌ها ساعت ۸ تا ۱۲ پاسخگوی شماست؛ جمعه‌ها تعطیل است.",
          category: "آموزش",
          keywords: ["ساعات کاری", "آموزش", "تعطیلات"],
          alternates: [
            "چه روزهایی می‌توانم با بخش آموزش تماس بگیرم؟",
            "ساعت پاسخگویی آموزش",
          ],
          deptIndex: 0,
        },
        {
          question: "شرایط ثبت‌نام در دوره‌ها چیست؟",
          officialAnswer:
            "برای ثبت‌نام در دوره‌ها باید ابتدا کارت عضویت فعال داشته باشید، سپس فرم ثبت‌نام دوره را تکمیل و هزینه دوره را پرداخت کنید. ظرفیت هر دوره محدود است و اولویت با اعضایی است که زودتر ثبت‌نام کنند.",
          category: "آموزش",
          keywords: ["ثبت‌نام", "دوره", "شهریه"],
          alternates: ["چطور در دوره ثبت‌نام کنم؟", "پیش‌نیازهای ثبت‌نام دوره"],
          deptIndex: 0,
        },
        {
          question: "چگونه کارت عضویت دریافت کنم؟",
          officialAnswer:
            "برای دریافت کارت عضویت، فرم درخواست عضویت را تکمیل کنید و تصویر مدرک شناسایی را بارگذاری نمایید. کارت حداکثر تا ۳ روز کاری صادر و از طریق پنل کاربری قابل دریافت است.",
          category: "عضویت",
          keywords: ["کارت عضویت", "عضویت", "صدور کارت"],
          alternates: ["مدارک لازم برای عضویت", "صدور کارت عضویت چقدر طول می‌کشد؟"],
          deptIndex: 1,
        },
      ];

      const qaEntryIds: string[] = [];
      for (const qa of demoQaEntries) {
        const entry = await tx.knowledgeQaEntry.create({
          data: {
            question: qa.question,
            officialAnswer: qa.officialAnswer,
            category: qa.category,
            keywords: JSON.stringify(qa.keywords),
            status: "PUBLISHED",
            createdById: adminId,
            alternates: {
              create: qa.alternates.map((question) => ({ question })),
            },
            departments: {
              create: [{ departmentId: departmentIds[qa.deptIndex] }],
            },
          },
          select: { id: true },
        });
        qaEntryIds.push(entry.id);
        console.log(`  + پرسش‌وپاسخ: ${qa.question}`);
      }

      const createdDoc = await tx.knowledgeDocument.create({
        data: {
          collectionId: collection.id,
          title: demoDocTitle,
          originalFilename: "demo-membership-guide.txt",
          mimeType: "text/plain",
          sizeBytes: Buffer.byteLength(demoDocText, "utf8"),
          checksum,
          storageKey,
          status: "UPLOADED",
          uploadedBy: adminId,
          versions: {
            create: {
              versionNo: 1,
              storageKey,
              mimeType: "text/plain",
              sizeBytes: Buffer.byteLength(demoDocText, "utf8"),
              checksum,
              uploadedBy: adminId,
            },
          },
        },
        select: { id: true },
      });
      console.log(`  + سند: ${demoDocTitle}`);

      // Demo operators (Phase 4 fair-distribution candidates).
      const newOperatorIds: string[] = [];
      for (const op of demoOperatorNames) {
        const exists = await tx.user.findUnique({ where: { username: op.username } });
        if (exists) continue;
        const created = await tx.user.create({
          data: {
            username: op.username,
            name: op.name,
            passwordHash: operatorPassword,
            roleKey: "OPERATOR",
            status: "ACTIVE",
            isAvailable: true,
          },
          select: { id: true },
        });
        newOperatorIds.push(created.id);
        console.log(`  + اپراتور: ${op.username} (رمز دمو: Operator2026DemoX)`);
      }
      for (const deptId of departmentIds) {
        for (const opId of newOperatorIds) {
          await tx.departmentMembership.create({
            data: { userId: opId, departmentId: deptId },
          });
        }
      }

      return {
        departmentIds,
        collectionId: collection.id,
        qaEntryIds,
        documentId: createdDoc.id,
        storageKey,
        newOperatorIds,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 2 — side effects that cannot join the transaction. On failure the
  // compensating cleanup restores the pre-seed state (rows + storage file).
  // ---------------------------------------------------------------------------
  try {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, demoDocText, "utf8");

    console.log("▶ Ingesting demo document through the RAG pipeline…");
    const { ingestDocumentNow } = await import("../src/lib/rag/ingest/pipeline");
    const ingest = await ingestDocumentNow(state.documentId, {
      id: "system",
      label: "demo-seed",
    });
    if (ingest.status !== "INDEXED") {
      throw new Error(`دموی دانش فهرست‌سازی نشد: ${ingest.error ?? "خطای نامشخص"}`);
    }
    console.log(
      `  + فهرست‌سازی شد (${ingest.chunks} chunks: ${ingest.sections} sections + ${ingest.children} children, model ${ingest.embeddingModel}, INDEXED)`
    );
  } catch (error) {
    console.error("✖ Post-commit phase failed — compensating cleanup started…");
    await compensate(db, state, absolutePath);
    console.error("✖ Demo seed failed:", error);
    await db.$disconnect();
    await shutdownCache();
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Audit trail (append-only; non-critical path).
  // ---------------------------------------------------------------------------
  await audit({
    actorType: "SYSTEM",
    action: "demo.seed.departments",
    entityType: "department",
    metadata: { count: DEMO_DEPARTMENTS.length, demo: true },
  });
  await audit({
    actorType: "SYSTEM",
    action: "demo.seed.knowledge",
    entityType: "KnowledgeCollection",
    entityId: state.collectionId,
    metadata: {
      demo: true,
      collections: 1,
      qaEntries: state.qaEntryIds.length,
      documents: 1,
    },
  });

  console.log(
    "✔ Demo data created (departments, operators, knowledge collection, Q&A, document). Remember: this data is demo-only."
  );
  await db.$disconnect();
  // The cache tier must be closed explicitly: an open Redis socket would keep
  // the event loop (and therefore this script) alive after the work is done.
  await shutdownCache();
}

/** Compensating cleanup — removes everything the seed transaction created. */
async function compensate(
  db: Prisma.TransactionClient,
  state: DemoState,
  absolutePath: string
): Promise<void> {
  try {
    await db.knowledgeQaEntry.deleteMany({
      where: { id: { in: state.qaEntryIds } },
    });
    await db.knowledgeDocument.deleteMany({
      where: { id: state.documentId },
    });
    await db.knowledgeCollection.deleteMany({
      where: { id: state.collectionId },
    });
    await db.department.deleteMany({
      where: { id: { in: state.departmentIds } },
    });
    await db.user.deleteMany({
      where: { id: { in: state.newOperatorIds } },
    });
    await rm(absolutePath, { force: true });
    console.log("✔ Compensating cleanup complete — database restored to pre-seed state.");
  } catch (cleanupError) {
    console.error(
      "✖ COMPENSATING CLEANUP FAILED — the database may hold partial demo rows.",
      cleanupError
    );
  }
}

main().catch(async (error) => {
  console.error("✖ Demo seed failed:", error);
  const { shutdownCache: close } = await import("@/lib/cache");
  await close().catch(() => undefined);
  process.exit(1);
});
