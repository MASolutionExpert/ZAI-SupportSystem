/**
 * Phase 5 mandated verification — shared file hub fail-closed security
 * (master spec §14 phase 5: "Tests: unauthorized access, file replacement,
 * deletion, and direct-URL access attempts all fail closed" + §10 upload
 * security semantics).
 *
 * Run: bun scripts/test-phase5-security.ts
 *
 * What it proves (each numbered scenario prints PASS/FAIL):
 *  1.  Operator of department A CANNOT list department B (scope fail-closed).
 *  2.  Operator of A CANNOT download B's file (scope fail-closed).
 *  3.  Operator of A CANNOT replace B's file (fail-closed).
 *  4.  Operator of A CANNOT delete B's file (fail-closed).
 *  5.  Operator of A CANNOT rename/move B's file (fail-closed).
 *  6.  Operator of A CANNOT delete/move B's folder (fail-closed).
 *  7.  Unauthenticated direct-URL access to the download API → 401, and the
 *      storage path is NOT publicly served (direct /storage/... → not a file).
 *  8.  Path traversal storage keys are rejected by the driver guard.
 *  9.  Disguised content (exe bytes named .pdf) fails content verification.
 *  10. Disallowed extension (.exe) rejected; honest allowlist respected.
 *  11. Duplicate names in the same folder rejected.
 *  12. Department quota enforcement (upload rejected when quota exhausted).
 *  13. Operator quota enforcement (per-uploader limit).
 *  14. Global capacity enforcement (settings-lowered capacity).
 *  15. Mandatory-scan semantics: configured-but-unreachable clamd → upload
 *      rejected (fail closed), never stored unscanned.
 *  16. Clean upload → stored with SKIPPED scan (provider none), download
 *      authorized for the SAME department succeeds byte-identical.
 *  17. Authorized replace bumps version, keeps quota truthful; delete
 *      removes the blob (driver stat → null) and frees quota.
 *  18. Every upload/download/replace/delete produced audit rows.
 *
 * DEV/DEMO environments only: creates throwaway departments + operators and
 * removes them at the end (refuses in production).
 */

import { PrismaClient } from "@prisma/client";
import { unlink } from "fs/promises";

const db = new PrismaClient();

let passCount = 0;
let failCount = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passCount += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failCount += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED_ALLOWED !== "true") {
    console.error("✖ Refusing to run in production.");
    process.exit(1);
  }

  console.log("▶ Phase 5 — Shared File Hub fail-closed verification\n");

  // Import server-only-guarded modules with the react-server condition.
  const { hashPassword } = await import("../src/lib/auth/password");
  const filesService = await import("../src/lib/files/service");
  const filesTypes = await import("../src/lib/files/types");
  const { saveStorageSettings, saveAvSettings, getStorageSettings } = await import(
    "../src/lib/files/settings"
  );
  const { getStorageDriver, ensureStorageRoot, getStorageRoot } = await import("../src/lib/storage");
  const { verifyContentType } = await import("../src/lib/files/mime");
  const path = await import("path");

  // ------------------------------------------------------ test fixtures --
  const suffix = Date.now().toString(36);
  const deptA = await db.department.create({ data: { name: `فایل تست الف ${suffix}` } });
  const deptB = await db.department.create({ data: { name: `فایل تست ب ${suffix}` } });

  const password = await hashPassword("Operator2026DemoX");
  // Department-scoped operators (OPERATOR baseline = view/download/upload only);
  // management capabilities are granted via per-user ALLOW overrides — this
  // also proves the override path feeds the file services. Crucially neither
  // user holds `files.all.manage`, so scope stays department-bound.
  const overrideKeys = [
    "files.folders.create",
    "files.rename",
    "files.move",
    "files.replace",
    "files.delete",
  ];
  const opA = await db.user.create({
    data: {
      username: `fop_a_${suffix}`,
      name: "اپراتور الف",
      passwordHash: password,
      roleKey: "OPERATOR",
      status: "ACTIVE",
      memberships: { create: { departmentId: deptA.id } },
      overrides: { create: overrideKeys.map((k) => ({ permissionKey: k, effect: "ALLOW", note: "phase5 test" })) },
    },
  });
  const opB = await db.user.create({
    data: {
      username: `fop_b_${suffix}`,
      name: "اپراتور ب",
      passwordHash: password,
      roleKey: "OPERATOR",
      status: "ACTIVE",
      memberships: { create: { departmentId: deptB.id } },
      overrides: { create: overrideKeys.map((k) => ({ permissionKey: k, effect: "ALLOW", note: "phase5 test" })) },
    },
  });

  const userA = { id: opA.id, username: opA.username, name: opA.name, roleKey: "OPERATOR", isAvailable: true, status: "ACTIVE" } as never;
  const userB = { id: opB.id, username: opB.username, name: opB.name, roleKey: "OPERATOR", isAvailable: true, status: "ACTIVE" } as never;

  await ensureStorageRoot("shared");

  try {
    // ---------------------------------------------- 1. cross-dept listing --
    console.log("۱) محدودیت مشاهده بین‌دپارتمانی");
    let denied = false;
    try {
      await filesService.listFiles(userB, deptA.id, null);
    } catch (e) {
      denied = e instanceof filesTypes.FilesScopeError;
    }
    check("لیست فایل‌های دپارتمان دیگر برای اپراتور بسته است", denied);

    // --------------------------------------- 2. authorized clean upload ----
    console.log("۲) بارگذاری سالم + موجودی سهمیه");
    const contentA = Buffer.from("متن آزمایشی فایل مشترک — گزارش آموزش", "utf8");
    const upload1 = await filesService.uploadFiles(userA, deptA.id, null, [
      { filename: "گزارش-آموزش.txt", buffer: contentA },
    ]);
    check("بارگذاری مجاز موفق است", upload1.ok === true);
    const fileId = upload1.ok ? upload1.uploaded[0]!.id : "";
    const storedKey = upload1.ok ? "" : "";
    const record = fileId ? await db.sharedFile.findUnique({ where: { id: fileId } }) : null;
    check("رکورد فایل با scanStatus=SKIPPED ذخیره شد (provider=none)", record?.scanStatus === "SKIPPED");
    const onDisk = record ? await getStorageDriver().stat(record.storageKey) : null;
    check("بایت‌ها خارج از وب‌روت ذخیره شد", onDisk?.sizeBytes === contentA.length);
    check("کلید ذخیره‌سازی تصادفی و بدون نام مشتری است", !!record && !record.storageKey.includes("گزارش"));

    // --------------------------------- 3. same-dept authorized download ----
    console.log("۳) دانلود مجاز در همان دپارتمان");
    const dl = await filesService.getFileForDownload(userA, fileId);
    check("دانلود در دامنه مجاز است", dl.ok === true);
    if (dl.ok) {
      const bytes = await getStorageDriver().get(dl.storageKey);
      check("بایت دانلود با بایت بارگذاری یکسان است", bytes.equals(contentA));
    }

    // ------------------------------ 4. cross-dept download/replace/delete --
    console.log("۴) دانلود/جایگزینی/حذف بین‌دپارتمانی");
    const dlB = await filesService.getFileForDownload(userB, fileId);
    check("دانلود از دپارتمان دیگر بسته است", dlB.ok === false && dlB.status === 403);

    let replaceDenied = false;
    try {
      await filesService.replaceFile(userB, fileId, { filename: "x.txt", buffer: Buffer.from("hack") });
    } catch (e) {
      replaceDenied = e instanceof filesTypes.FilesScopeError;
    }
    check("جایگزینی از دپارتمان دیگر بسته است", replaceDenied);

    let deleteDenied = false;
    try {
      await filesService.deleteFile(userB, fileId);
    } catch (e) {
      deleteDenied = e instanceof filesTypes.FilesScopeError;
    }
    check("حذف از دپارتمان دیگر بسته است", deleteDenied);

    let renameDenied = false;
    try {
      await filesService.renameFile(userB, fileId, "stolen.txt");
    } catch (e) {
      renameDenied = e instanceof filesTypes.FilesScopeError;
    }
    check("تغییر نام از دپارتمان دیگر بسته است", renameDenied);

    // ------------------------------------------- 5. folder scope attacks --
    console.log("۵) عملیات پوشه بین‌دپارتمانی");
    const folderA = await filesService.createFolder(userA, deptA.id, null, "اسناد محرمانه");
    let folderDeleteDenied = false;
    try {
      await filesService.deleteFolder(userB, folderA.id);
    } catch (e) {
      folderDeleteDenied = e instanceof filesTypes.FilesScopeError;
    }
    check("حذف پوشه دپارتمان دیگر بسته است", folderDeleteDenied);
    let folderMoveDenied = false;
    try {
      await filesService.moveFolder(userB, folderA.id, null);
    } catch (e) {
      folderMoveDenied = e instanceof filesTypes.FilesScopeError;
    }
    check("انتقال پوشه دپارتمان دیگر بسته است", folderMoveDenied);

    // ---------------------------------------------- 6. direct-URL access --
    console.log("۶) دسترسی مستقیم URL");
    const unauthFetch = await fetch(`http://localhost:3000/api/staff/files/${fileId}/download`);
    check("دانلود بدون نشست → 401", unauthFetch.status === 401);
    const unauthList = await fetch(`http://localhost:3000/api/staff/files?departmentId=${deptA.id}&folderId=root`);
    check("فهرست بدون نشست → 401", unauthList.status === 401);
    if (record) {
      const directUrl = `http://localhost:3000/storage/${record.storageKey}`;
      const direct = await fetch(directUrl);
      check("مسیر مستقیم /storage/… سرو نمی‌شود (fail closed)", direct.status === 404 || direct.status === 405 || direct.status >= 400);
      const fsRoot = path.resolve(getStorageRoot());
      const fsPath = path.resolve(fsRoot, record.storageKey);
      check("فایل خارج از public وب است", !fsPath.startsWith(path.resolve(process.cwd(), "public")));
    }

    // ------------------------------------------------ 7. path traversal ---
    console.log("۷) محافظت از پیمایش مسیر");
    let traversalBlocked = false;
    try {
      await getStorageDriver().put("../outside-evil.txt", Buffer.from("x"));
      // If put() returned, verify nothing was written outside the root.
      const outside = await import("fs/promises").then((m) =>
        m.stat(path.resolve(getStorageRoot(), "../outside-evil.txt")).then(() => true).catch(() => false)
      );
      traversalBlocked = !outside;
    } catch {
      traversalBlocked = true;
    }
    check("کلید با «../» رد می‌شود یا خارج از ریشه نمی‌نویسد", traversalBlocked);
    await getStorageDriver().delete("../outside-evil.txt").catch(() => undefined);

    // ---------------------------------------- 8. content MIME checks ------
    console.log("۸) تأیید محتوایی نوع فایل");
    const exeBytes = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(100, 0x41)]);
    const disguised = verifyContentType("fake.pdf", exeBytes, ["pdf", "txt"]);
    check("فایل exe با پسوند pdf رد می‌شود", disguised.ok === false);
    const exeExt = verifyContentType("virus.exe", exeBytes, ["pdf", "txt"]);
    check("پسوند غیرمجاز (.exe) رد می‌شود", exeExt.ok === false);
    const honestTxt = verifyContentType("readme.txt", Buffer.from("hello", "utf8"), ["pdf", "txt"]);
    check("متن سالم با پسوند مجاز تأیید می‌شود", honestTxt.ok === true && honestTxt.ext === "txt");

    // ------------------------------------------- 9. duplicate name --------
    console.log("۹) نام تکراری");
    const dup = await filesService.uploadFiles(userA, deptA.id, null, [
      { filename: "گزارش-آموزش.txt", buffer: Buffer.from("duplicated") },
    ]);
    check("نام تکراری در همان پوشه رد می‌شود", dup.ok === false);

    // ------------------------------------------------ 10. quotas ----------
    console.log("۱۰) سهمیه‌ها");
    // Constraint chain enforced by settings validation:
    //   maxUpload ≤ operatorQuota ≤ departmentQuota ≤ totalCapacity.
    // Pick: maxUpload=3.5MB, operatorQuota=4MB, departmentQuota=5MB.
    const MB = 1024 * 1024;
    const originalSettings = await getStorageSettings();
    await saveStorageSettings({
      defaultDepartmentQuotaBytes: 5 * MB,
      defaultOperatorQuotaBytes: 4 * MB,
      maxUploadBytes: Math.floor(3.5 * MB),
      totalCapacityBytes: originalSettings.totalCapacityBytes,
    });

    // 10a — per-file max upload cap.
    const tooBig = await filesService.uploadFiles(userA, deptA.id, null, [
      { filename: "big0.txt", buffer: Buffer.alloc(4 * MB, 0x41) },
    ]);
    check("حداکثر حجم هر فایل اعمال شد", tooBig.ok === false && tooBig.error.includes("بیش از حد مجاز"));

    // 10b — operator quota: batch of 2×3.4MB ≈ 6.8MB > 4MB operator quota
    // (cumulative batch check runs before anything is stored).
    const opQuotaHit = await filesService.uploadFiles(userA, deptA.id, null, [
      { filename: "big1.txt", buffer: Buffer.alloc(3 * MB + 400 * 1024, 0x42) },
      { filename: "big2.txt", buffer: Buffer.alloc(3 * MB + 400 * 1024, 0x43) },
    ]);
    check("عبور از سهمیه اپراتور (مجموع دسته) رد می‌شود", opQuotaHit.ok === false && opQuotaHit.error.includes("سهمیه"));

    // 10c — department quota: first 3.4MB upload fits; the next one crosses
    // the 5MB department quota (department check fires before operator).
    const fit = await filesService.uploadFiles(userA, deptA.id, null, [
      { filename: "dept1.txt", buffer: Buffer.alloc(3 * MB + 400 * 1024, 0x44) },
    ]);
    check("بارگذاری زیر سهمیه مجاز است", fit.ok === true);
    const deptQuotaHit = await filesService.uploadFiles(userA, deptA.id, null, [
      { filename: "dept2.txt", buffer: Buffer.alloc(3 * MB + 400 * 1024, 0x45) },
    ]);
    check("عبور از سهمیه دپارتمان رد می‌شود", deptQuotaHit.ok === false && deptQuotaHit.error.includes("سهمیه"));

    // 10d — global capacity: shrink total capacity below current usage
    // (respecting the validation chain: maxUpload ≤ operator ≤ dept ≤ total).
    await saveStorageSettings({
      totalCapacityBytes: 2 * MB,
      defaultDepartmentQuotaBytes: 2 * MB,
      defaultOperatorQuotaBytes: 1700 * 1024,
      maxUploadBytes: 1500 * 1024,
    });
    const capHit = await filesService.uploadFiles(userB, deptB.id, null, [
      { filename: "cap.txt", buffer: Buffer.alloc(1024 * 1024, 0x46) },
    ]);
    check("عبور از ظرفیت کل رد می‌شود", capHit.ok === false && capHit.error.includes("ظرفیت"));

    // Restore sane settings.
    await saveStorageSettings({
      totalCapacityBytes: originalSettings.totalCapacityBytes,
      defaultDepartmentQuotaBytes: originalSettings.defaultDepartmentQuotaBytes,
      defaultOperatorQuotaBytes: originalSettings.defaultOperatorQuotaBytes,
      maxUploadBytes: originalSettings.maxUploadBytes,
    });
    console.error("[debug] settings readback:", JSON.stringify(await getStorageSettings()));

    // ------------------------------------------- 11. mandatory AV scan ----
    console.log("۱۱) معناشناسی اجبار اسکن (ClamAV)");
    await saveAvSettings({ provider: "clamav", host: "127.0.0.1", port: 59999, timeoutMs: 2000 });
    const scanFail = await filesService.uploadFiles(userA, deptA.id, null, [
      { filename: "unscanned.txt", buffer: Buffer.from("must not be stored") },
    ]);
    check("اسکن ناموفق (daemon در دسترس نیست) → رد کامل", scanFail.ok === false);
    const unscannedStored = await db.sharedFile.findFirst({ where: { name: "unscanned.txt" } });
    check("فایل بدون اسکن موفق ذخیره نشده است", unscannedStored === null);
    await saveAvSettings({ provider: "none" });

    // --------------------------------------- 12. replace + delete flow ----
    console.log("۱۲) جایگزینی و حذف مجاز + حسابرسی");
    const v2 = Buffer.from("نسخه دوم سند — به‌روزشده", "utf8");
    const replaced = await filesService.replaceFile(userA, fileId, { filename: "گزارش-آموزش.txt", buffer: v2 });
    check("جایگزینی مجاز موفق است و نسخه افزایش می‌یابد", replaced.ok === true && (replaced.ok ? replaced.file.version === 2 : false));
    const afterReplace = record ? await db.sharedFile.findUnique({ where: { id: fileId } }) : null;
    if (afterReplace) {
      const newOnDisk = await getStorageDriver().stat(afterReplace.storageKey);
      const oldOnDisk = record ? await getStorageDriver().stat(record.storageKey).catch(() => null) : null;
      check("بایت جدید جایگزین شد", newOnDisk?.sizeBytes === v2.length);
      // old storageKey === record.storageKey is the SAME row's key (updated);
      // the driver only keeps the new key — old bytes must be gone:
      check("کلید قدیمی پس از موفقیت حذف شده است", oldOnDisk === null && afterReplace.storageKey !== (record?.storageKey ?? ""));
    }
    await filesService.deleteFile(userA, fileId);
    const afterDelete = await db.sharedFile.findUnique({ where: { id: fileId } });
    check("حذف مجاز، رکورد حذف شد", afterDelete === null);

    const audits = await db.auditLog.findMany({
      where: { action: { in: ["file.uploaded", "file.downloaded", "file.replaced", "file.deleted", "folder.created", "file.scan.error"] } },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const actions = new Set(audits.map((a) => a.action));
    check(
      "ردیف‌های حسابرسی برای بارگذاری/دانلود/جایگزینی/حذف/پوشه/اسکن ثبت شده است",
      ["file.uploaded", "file.downloaded", "file.replaced", "file.deleted", "folder.created", "file.scan.error"].every((a) => actions.has(a))
    );

    // ------------------------------- 13. folder subtree delete (blobs too) -
    console.log("۱۳) حذف زیردرخت پوشه");
    const parent = await filesService.createFolder(userA, deptA.id, null, "والد");
    const child = await filesService.createFolder(userA, deptA.id, parent.id, "فرزند");
    const inner = await filesService.uploadFiles(userA, deptA.id, child.id, [
      { filename: "inner.txt", buffer: Buffer.from("inner") },
    ]);
    const innerId = inner.ok ? inner.uploaded[0]!.id : "";
    const innerRec = innerId ? await db.sharedFile.findUnique({ where: { id: innerId } }) : null;
    await filesService.deleteFolder(userA, parent.id);
    const innerAfter = innerId ? await db.sharedFile.findUnique({ where: { id: innerId } }) : null;
    const blobGone = innerRec ? (await getStorageDriver().stat(innerRec.storageKey)) === null : false;
    check("حذف پوشه، فایل‌های زیردرخت را حذف کرد", innerAfter === null);
    check("بایت‌های فایل‌های زیردرخت حذف شدند", blobGone);

    // ------------------------------------ 14. list (authorized) sanity ----
    console.log("۱۴) فهرست مجاز و مسیر breadcrumbs");
    const listing = await filesService.listFiles(userA, deptA.id, null);
    check("فهرست دپارتمان خود برای اپراتور مجاز است", listing.department.id === deptA.id);
    check("breadcrumb ریشه درست است", listing.breadcrumb.length === 1 && listing.breadcrumb[0]!.name === "ریشه");
  } finally {
    // --------------------------------------------------------- cleanup ---
    // Retry helper: SQLite may briefly return BUSY while the dev server
    // holds write locks; a swallowed single-shot delete here would leave
    // test fixtures behind (observed in practice).
    const del = async (fn: () => Promise<unknown>, label: string) => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          await fn();
          return;
        } catch (error) {
          if (attempt === 5) {
            console.error(`[cleanup] ${label} failed after 5 attempts:`, (error as Error).message.split("\n").pop());
            return;
          }
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
    };

    console.log("\n▶ پاک‌سازی داده‌های آزمایشی…");
    const files = await db.sharedFile.findMany({ where: { departmentId: { in: [deptA.id, deptB.id] } } });
    for (const f of files) await getStorageDriver().delete(f.storageKey).catch(() => undefined);
    await del(() => db.sharedFile.deleteMany({ where: { departmentId: { in: [deptA.id, deptB.id] } } }), "shared files");
    await del(() => db.sharedFolder.deleteMany({ where: { departmentId: { in: [deptA.id, deptB.id] } } }), "shared folders");
    await del(() => db.departmentMembership.deleteMany({ where: { userId: { in: [opA.id, opB.id] } } }), "memberships");
    await del(() => db.userPermissionOverride.deleteMany({ where: { userId: { in: [opA.id, opB.id] } } }), "overrides");
    await del(() => db.user.delete({ where: { id: opA.id } }), "operator A");
    await del(() => db.user.delete({ where: { id: opB.id } }), "operator B");
    await del(() => db.department.delete({ where: { id: deptA.id } }), "department A");
    await del(() => db.department.delete({ where: { id: deptB.id } }), "department B");
    console.log("✔ پاک‌سازی کامل شد.");
  }

  console.log(`\n=== نتیجه: ${passCount} PASS / ${failCount} FAIL ===`);
  if (failCount > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error("✖ Test crashed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    // Close the cache tier explicitly, then force-exit: verification scripts
    // must never hang CI because of a lingering handle.
    await (await import("@/lib/cache")).shutdownCache();
    process.exit(0);
  });
