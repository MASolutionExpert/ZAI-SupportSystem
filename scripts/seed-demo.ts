/**
 * Explicit DEMO seed — `bun run seed-demo`.
 *
 * Master spec section 15: demo data must only be inserted through an explicit
 * development/demo process. This script:
 *   - refuses to run in production,
 *   - refuses to run when any department / knowledge collection / Q&A entry
 *     already exists (never mixes demo and real data, never overwrites),
 *   - inserts demo departments, a demo knowledge collection, curated Q&A
 *     entries and one demo indexed document so the public landing page, the
 *     AI assistant pipeline and the operator inbox can be evaluated during
 *     development.
 *
 * The demo document is inserted directly as INDEXED with pre-computed chunks
 * (deterministic demo content — NOT a pipeline bypass for real uploads; real
 * uploads always go through the extraction pipeline).
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";

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

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED_ALLOWED !== "true") {
    console.error("✖ Refusing to seed demo data in production (NODE_ENV=production).");
    process.exit(1);
  }

  const { db } = await import("../src/lib/db");
  const { audit } = await import("../src/lib/audit");

  const existing = await db.department.count();
  if (existing > 0) {
    console.error(
      `✖ ${existing} department(s) already exist — demo seed aborted to protect real data.`
    );
    await db.$disconnect();
    process.exit(1);
  }

  const existingCollections = await db.knowledgeCollection.count();
  const existingQa = await db.knowledgeQaEntry.count();
  if (existingCollections > 0 || existingQa > 0) {
    console.error(
      "✖ Knowledge Base content already exists — demo seed aborted to protect real data."
    );
    await db.$disconnect();
    process.exit(1);
  }

  console.log("▶ Seeding demo departments (explicit development seed)…");
  const createdDepartments: { id: string; name: string }[] = [];
  for (const dept of DEMO_DEPARTMENTS) {
    const created = await db.department.create({
      data: {
        ...dept,
        isActive: true,
        isPublic: true,
      },
    });
    createdDepartments.push({ id: created.id, name: created.name });
    console.log(`  + ${dept.name}`);
  }

  // ------------------------------------------------- Demo knowledge base --
  console.log("▶ Seeding demo knowledge collection…");
  const collection = await db.knowledgeCollection.create({
    data: {
      name: "دانش پایه سازمان (دمو)",
      description: "مجموعه دانش عمومی سازمان برای ارزیابی دستیار هوشمند — داده دمو.",
      access: "GLOBAL",
      isActive: true,
    },
  });
  console.log(`  + ${collection.name}`);

  const { normalizePersian } = await import("../src/lib/kb/text");

  console.log("▶ Seeding demo Q&A entries…");
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
      deptName: "دپارتمان آموزش",
    },
    {
      question: "شرایط ثبت‌نام در دوره‌ها چیست؟",
      officialAnswer:
        "برای ثبت‌نام در دوره‌ها باید ابتدا کارت عضویت فعال داشته باشید، سپس فرم ثبت‌نام دوره را تکمیل و هزینه دوره را پرداخت کنید. ظرفیت هر دوره محدود است و اولویت با اعضایی است که زودتر ثبت‌نام کنند.",
      category: "آموزش",
      keywords: ["ثبت‌نام", "دوره", "شهریه"],
      alternates: ["چطور در دوره ثبت‌نام کنم؟", "پیش‌نیازهای ثبت‌نام دوره"],
      deptName: "دپارتمان آموزش",
    },
    {
      question: "چگونه کارت عضویت دریافت کنم؟",
      officialAnswer:
        "برای دریافت کارت عضویت، فرم درخواست عضویت را تکمیل کنید و تصویر مدرک شناسایی را بارگذاری نمایید. کارت حداکثر تا ۳ روز کاری صادر و از طریق پنل کاربری قابل دریافت است.",
      category: "عضویت",
      keywords: ["کارت عضویت", "عضویت", "صدور کارت"],
      alternates: ["مدارک لازم برای عضویت", "صدور کارت عضویت چقدر طول می‌کشد؟"],
      deptName: "دپارتمان عضویت",
    },
  ];

  for (const qa of demoQaEntries) {
    const dept = createdDepartments.find((d) => d.name === qa.deptName);
    if (!dept) continue;
    await db.knowledgeQaEntry.create({
      data: {
        question: qa.question,
        officialAnswer: qa.officialAnswer,
        category: qa.category,
        keywords: JSON.stringify(qa.keywords),
        status: "PUBLISHED",
        createdById: await superAdminId(db),
        alternates: {
          create: qa.alternates.map((question) => ({ question })),
        },
        departments: {
          create: [{ departmentId: dept.id }],
        },
      },
    });
    console.log(`  + Q&A: ${qa.question}`);
  }

  console.log("▶ Seeding demo indexed document…");
  const demoDocTitle = "راهنمای عضویت سازمان";
  const demoDocText = `راهنمای عضویت سازمان

انواع عضویت
سازمان سه نوع عضویت دارد: عضویت عادی، عضویت طلایی و عضویت سازمانی. عضویت عادی شامل دسترسی به رویدادهای عمومی است. عضویت طلایی علاوه بر رویدادهای عمومی، شامل تخفیف دوره‌های آموزشی می‌شود.

تمدید عضویت
تمدید عضویت از ۱۰ روز پیش از تاریخ انقضا در پنل کاربری فعال می‌شود. اگر عضویت بیش از ۳۰ روز منقضی شود، باید فرم عضویت از نو تکمیل گردد.

لغو عضویت
درخواست لغو عضویت باید از طریق پنل کاربری ثبت شود و ظرف ۷ روز کاری بررسی می‌گردد. هزینه دوره‌های خریداری‌شده پس از لغو عضویت بازگشت داده نمی‌شود.`;

  const storageDir = process.env.STORAGE_DIR ?? "./storage";
  const docId = `demo-${Date.now().toString(36)}`;
  const storageKey = `kb/${docId}.txt`;
  const storageRoot = path.isAbsolute(storageDir)
    ? storageDir
    : path.join(process.cwd(), storageDir);
  const absolutePath = path.join(storageRoot, storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, demoDocText, "utf8");

  const { createHash } = await import("crypto");
  const checksum = createHash("sha256").update(demoDocText).digest("hex");

  const createdDoc = await db.knowledgeDocument.create({
    data: {
      collectionId: collection.id,
      title: demoDocTitle,
      originalFilename: "demo-membership-guide.txt",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(demoDocText, "utf8"),
      checksum,
      storageKey,
      status: "UPLOADED",
      uploadedBy: await superAdminId(db),
      versions: {
        create: {
          versionNo: 1,
          storageKey,
          mimeType: "text/plain",
          sizeBytes: Buffer.byteLength(demoDocText, "utf8"),
          checksum,
          uploadedBy: await superAdminId(db),
        },
      },
    },
    select: { id: true },
  });

  // RAG engine ingestion (structure-aware chunks + hashed embeddings +
  // provenance) — synchronous inside the demo seed script on purpose.
  const { ingestDocumentNow } = await import("../src/lib/rag/ingest/pipeline");
  const ingest = await ingestDocumentNow(createdDoc.id, {
    id: "system",
    label: "demo-seed",
  });
  if (ingest.status !== "INDEXED") {
    throw new Error(`دموی دانش فهرست‌سازی نشد: ${ingest.error ?? "خطای نامشخص"}`);
  }
  console.log(
    `  + Document: ${demoDocTitle} (${ingest.chunks} chunks: ${ingest.sections} sections + ${ingest.children} children, model ${ingest.embeddingModel}, INDEXED)`
  );

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
    entityId: collection.id,
    metadata: {
      demo: true,
      collections: 1,
      qaEntries: demoQaEntries.length,
      documents: 1,
    },
  });

  // ------------------------------------------------- Demo operators (Phase 4 fair distribution) --
  console.log("▶ Seeding demo operators…");
  const bcrypt = await import("bcryptjs");
  const operatorRole = await db.role.findUnique({ where: { key: "OPERATOR" } });
  if (!operatorRole) {
    console.error("✖ OPERATOR role missing — run bootstrap first.");
    await db.$disconnect();
    process.exit(1);
  }
  const operatorPassword = await bcrypt.hash("Operator2026DemoX", 12);
  const demoOperatorNames = [
    { username: "operator1", name: "اپراتور نمونه یک" },
    { username: "operator2", name: "اپراتور نمونه دو" },
  ];
  const createdOperators: { id: string; name: string }[] = [];
  for (const op of demoOperatorNames) {
    const exists = await db.user.findUnique({ where: { username: op.username } });
    if (exists) {
      createdOperators.push({ id: exists.id, name: exists.name });
      continue;
    }
    const created = await db.user.create({
      data: {
        username: op.username,
        name: op.name,
        passwordHash: operatorPassword,
        roleKey: "OPERATOR",
        status: "ACTIVE",
        isAvailable: true,
      },
    });
    createdOperators.push({ id: created.id, name: created.name });
    console.log(`  + ${op.username} (رمز دمو: Operator2026DemoX)`);
  }
  // Both operators join every demo department (fair-distribution candidates).
  for (const dept of createdDepartments) {
    for (const op of createdOperators) {
      await db.departmentMembership.upsert({
        where: { userId_departmentId: { userId: op.id, departmentId: dept.id } },
        update: {},
        create: { userId: op.id, departmentId: dept.id },
      });
    }
  }

  console.log("✔ Demo data created (departments, operators, knowledge collection, Q&A, document). Remember: this data is demo-only.");
  await db.$disconnect();
}

/** First existing super admin id (demo rows need a real author FK). */
async function superAdminId(db: {
  user: { findFirst: (args: { where: { roleKey: string }; select: { id: boolean } }) => Promise<{ id: string } | null> };
}): Promise<string> {
  const admin = await db.user.findFirst({
    where: { roleKey: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (!admin) {
    throw new Error("No SUPER_ADMIN exists — run `bun run bootstrap` first.");
  }
  return admin.id;
}

main().catch((error) => {
  console.error("✖ Demo seed failed:", error);
  process.exit(1);
});
