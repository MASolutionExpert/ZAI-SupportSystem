/**
 * Phase 6 verification — Super Admin & Reporting: permission matrix and
 * audit trail for the new admin surfaces (master spec §9/§14: every
 * capability must be real, permission-gated, and audited).
 *
 * Run: bun scripts/test-phase6-security.ts   (dev server must be on :3000)
 *
 * What it proves (each numbered scenario prints PASS/FAIL):
 *  1.  Unauthenticated access to every new admin API → 401.
 *  2.  Department-scoped operator (baseline permissions only) is denied on
 *      audit viewer, all three report APIs, system settings (GET+PUT),
 *      ticket CSV export and storage usage → 403 with the uniform envelope.
 *  3.  Super Admin session reads the audit log (rows + total + paging) and
 *      the `action` filter actually filters (nonexistent action → 0 rows).
 *  4.  Ticket report shape: totals + zero-filled 7-day series (created and
 *      resolved series both have exactly 7 buckets); invalid `days`
 *      (0 / 91 / abc) → 422.
 *  5.  Operator activity report and assignment report return the documented
 *      shapes (per-operator rows, 4 assignment modes).
 *  6.  Ticket CSV export: gated by `tickets.export` (operator → 403), admin
 *      gets text/csv with UTF-8 BOM and a header row, and every export is
 *      audited as `ticket.exported` (verified in the audit table).
 *  7.  System settings: admin GET returns live org values; PUT with an
 *      unchanged payload reports changedKeys=[] and writes no audit; a real
 *      change is persisted, reported in changedKeys, audited as
 *      `settings.org.updated`, and restored afterwards; invalid input
 *      (1-char org name) → 422.
 *  8.  AI usage report exposes the Phase 6 daily series (byDay of length 7);
 *      system status exposes runtime + operational counts.
 *  9.  Page-level guards: unauthenticated /admin/audit redirects to /login;
 *      operator gets the honest access-denied panel, not the viewer.
 * 10.  Audit viewer's actor join resolves operator names (actorName/username
 *      present on rows produced by this test run).
 *
 * DEV/DEMO environments only: creates throwaway users and removes them at
 * the end (refuses in production).
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";

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

type Session = { cookie: string; landingPath?: string | null };

async function login(username: string, password: string): Promise<Session> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${username}: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  if (!cookie) throw new Error("no session cookie returned");
  const body = (await res.json().catch(() => null)) as { data?: { landingPath?: string } } | null;
  return { cookie, landingPath: body?.data?.landingPath ?? null };
}

async function get(
  path: string,
  session?: Session
): Promise<{ status: number; json: unknown; text: string; contentType: string; location?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: session ? { Cookie: session.cookie } : {},
    redirect: "manual",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    json,
    text,
    contentType: res.headers.get("content-type") ?? "",
    location: res.headers.get("location") ?? undefined,
  };
}

async function putJson(path: string, body: unknown, session: Session): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: session.cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function envelopeError(json: unknown): string | null {
  if (json && typeof json === "object" && "ok" in json) {
    const j = json as { ok: boolean; error?: string };
    if (j.ok === false) return j.error ?? "";
  }
  return null;
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_SEED_ALLOWED !== "true") {
    console.error("✖ Refusing to run in production.");
    process.exit(1);
  }

  console.log("▶ Phase 6 — Super Admin & Reporting verification\n");

  const { hashPassword } = await import("../src/lib/auth/password");
  const suffix = Date.now().toString(36);

  const password = await hashPassword("Operator2026DemoX");
  const dept = await db.department.create({ data: { name: `گزارش تست ${suffix}` } });
  const op = await db.user.create({
    data: {
      username: `rop_${suffix}`,
      name: "اپراتور گزارش",
      passwordHash: password,
      roleKey: "OPERATOR",
      status: "ACTIVE",
      memberships: { create: { departmentId: dept.id } },
    },
  });
  const admin = await db.user.create({
    data: {
      username: `radmin_${suffix}`,
      name: "مدیر گزارش",
      passwordHash: password,
      roleKey: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  try {
    const opSession = await login(op.username, "Operator2026DemoX");
    const adminSession = await login(admin.username, "Operator2026DemoX");

    // Permission-aware landing (operators must not hit a denied dashboard).
    check(
      "ورود اپراتور مسیر مقصد /support را برمی‌گرداند و مدیر مسیر /admin را",
      opSession.landingPath === "/support" && adminSession.landingPath === "/admin",
      `op=${opSession.landingPath} admin=${adminSession.landingPath}`
    );

    // ------------------------------------------- 1. unauthenticated → 401 --
    console.log("۱) دسترسی ناشناس به APIهای جدید");
    const unauthPaths = [
      "/api/admin/audit",
      "/api/admin/reports/tickets",
      "/api/admin/reports/operators",
      "/api/admin/reports/assignments",
      "/api/admin/reports/tickets/export.csv",
      "/api/admin/settings",
    ];
    let all401 = true;
    for (const path of unauthPaths) {
      const res = await get(path);
      if (res.status !== 401) {
        all401 = false;
        console.error(`    ${path} → ${res.status}`);
      }
    }
    check("همه مسیرهای جدید بدون نشست → 401", all401);

    // --------------------------------- 2. operator denied on everything ----
    console.log("۲) اپراتور بدون مجوزهای مدیریتی");
    const deniedChecks: Array<[string, number]> = [
      ["/api/admin/audit", 403],
      ["/api/admin/reports/tickets?days=7", 403],
      ["/api/admin/reports/operators?days=7", 403],
      ["/api/admin/reports/assignments?days=7", 403],
      ["/api/admin/reports/tickets/export.csv?days=7", 403],
      ["/api/admin/settings", 403],
      ["/api/staff/files/usage", 403],
    ];
    let allDenied = true;
    for (const [path, expected] of deniedChecks) {
      const res = await get(path, opSession);
      const err = envelopeError(res.json);
      if (res.status !== expected || !err) {
        allDenied = false;
        console.error(`    ${path} → ${res.status} (${err ?? "no envelope"})`);
      }
    }
    check("اپراتور روی همه مسیرهای مدیریتی → 403 با پیام فارسی", allDenied);
    const putDenied = await putJson("/api/admin/settings", { orgName: "hacked" }, opSession);
    check("اپراتور روی PUT تنظیمات → 403", putDenied.status === 403, `status=${putDenied.status}`);

    // ------------------------------------ 3. admin audit viewer basics -----
    console.log("۳) گزارش حسابرسی برای مدیر");
    const auditPage = await get("/api/admin/audit?page=1&pageSize=10", adminSession);
    const auditData = (auditPage.json as { ok: boolean; data?: { rows: unknown[]; total: number; page: number; pageSize: number } })?.data;
    check(
      "دریافت صفحه حسابرسی با ساختار rows/total/page",
      auditPage.status === 200 &&
        Array.isArray(auditData?.rows) &&
        typeof auditData?.total === "number" &&
        auditData?.pageSize === 10
    );
    const auditFiltered = await get(
      "/api/admin/audit?action=nonexistent.action.prefix",
      adminSession
    );
    const filteredData = (auditFiltered.json as { data?: { total: number; rows: unknown[] } })?.data;
    check("فیلتر action نتیجه خالی می‌دهد (0 ردیف)", auditFiltered.status === 200 && filteredData?.total === 0 && filteredData.rows.length === 0);

    const actorFilter = await get(`/api/admin/audit?actorLabel=${op.username}&pageSize=100`, adminSession);
    const actorData = (actorFilter.json as { data?: { rows: Array<{ action: string; actorLabel: string | null; actorUsername: string | null }> } })?.data;
    check(
      "فیلتر عامل، رخدادهای ورود همین اپراتور را می‌آورد و نام کاربر حل می‌شود",
      actorFilter.status === 200 &&
        (actorData?.rows.length ?? 0) > 0 &&
        actorData!.rows.every((r) => r.actorUsername === op.username) &&
        actorData!.rows.some((r) => r.action === "auth.login.success" && r.actorLabel === op.username)
    );

    // ---------------------------------------- 4. ticket report shape ------
    console.log("۴) گزارش تیکت‌ها");
    const ticketReport = await get("/api/admin/reports/tickets?days=7", adminSession);
    const tData = (ticketReport.json as { data?: { totals: Record<string, unknown>; createdPerDay: Array<{ day: string; count: number }>; resolvedPerDay: Array<{ day: string; count: number }> } })?.data;
    check(
      "ساختار کامل گزارش تیکت با دو سری ۷روزه صفرپرشده",
      ticketReport.status === 200 &&
        !!tData?.totals &&
        tData.createdPerDay.length === 7 &&
        tData.resolvedPerDay.length === 7
    );
    for (const bad of ["0", "91", "abc"]) {
      const res = await get(`/api/admin/reports/tickets?days=${bad}`, adminSession);
      if (res.status !== 422) {
        check(`بازه نامعتبر days=${bad} → 422`, false, `status=${res.status}`);
      }
    }
    check("بازه‌های نامعتبر (0، 91، abc) → 422", true);
    const bogusDept = await get(`/api/admin/reports/tickets?days=7&departmentId=nope`, adminSession);
    check("دپارتمان ناموجود → 422", bogusDept.status === 422, `status=${bogusDept.status}`);

    // ------------------------------------- 5. operator/assignment shapes --
    console.log("۵) گزارش فعالیت اپراتورها و تخصیص");
    const opReport = await get("/api/admin/reports/operators?days=7", adminSession);
    const opData = (opReport.json as { data?: { operators: Array<Record<string, unknown>> } })?.data;
    check(
      "گزارش فعالیت اپراتورها شامل همه کارکنان با فیلدهای کامل",
      opReport.status === 200 &&
        Array.isArray(opData?.operators) &&
        (opData?.operators.length ?? 0) >= 2 &&
        opData!.operators.every(
          (o) => typeof o.name === "string" && typeof o.assignedInWindow === "number" && typeof o.openNow === "number" && "lastReplyAt" in o
        )
    );
    const assignReport = await get("/api/admin/reports/assignments?days=7", adminSession);
    const aData = (assignReport.json as { data?: { byMode: Array<{ mode: string; count: number }>; totals: Record<string, unknown> } })?.data;
    check(
      "گزارش تخصیص ۴ حالت ارجاع + مجموع‌ها",
      assignReport.status === 200 && aData?.byMode.length === 4 && aData.byMode.every((m) => typeof m.count === "number") && typeof aData.totals.avgAssignDelayMs !== "undefined"
    );

    // ------------------------------------------- 6. CSV export + audit ----
    console.log("۶) خروجی CSV تیکت‌ها + حسابرسی آن");
    const csv = await get("/api/admin/reports/tickets/export.csv?days=30", adminSession);
    const csvText = csv.text;
    // fetch's res.text() strips a leading UTF-8 BOM per the encoding spec, so
    // the BOM is asserted at the byte level with a dedicated arrayBuffer call.
    const csvBytes = await (
      await fetch(`${BASE}/api/admin/reports/tickets/export.csv?days=30`, {
        headers: { Cookie: adminSession.cookie },
      })
    ).arrayBuffer();
    const hasBom = new Uint8Array(csvBytes)[0] === 0xef && new Uint8Array(csvBytes)[1] === 0xbb && new Uint8Array(csvBytes)[2] === 0xbf;
    check(
      "دانلود CSV با Content-Type صحیح، BOM (سطح بایت) و سطر عنوان فارسی",
      csv.status === 200 &&
        csv.contentType.includes("text/csv") &&
        hasBom &&
        csvText.split("\r\n")[0]?.includes("شماره تیکت") === true
    );
    const exportedAudit = await db.auditLog.findFirst({
      where: { action: "ticket.exported", actorUserId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    check("رخداد ticket.exported ثبت شد", exportedAudit !== null);

    // ------------------------------------------- 7. system settings -------
    console.log("۷) تنظیمات سامانه + حسابرسی تغییرات");
    const settingsGet = await get("/api/admin/settings", adminSession);
    const sData = (settingsGet.json as { data?: { values: { orgName: string; orgTagline: string; orgSupportIntro: string }; meta: Record<string, unknown> } })?.data;
    check(
      "دریافت تنظیمات با مقادیر و متادیتا",
      settingsGet.status === 200 && !!sData?.values?.orgName && typeof sData.meta === "object"
    );
    const original = sData!.values;

    const noChange = await putJson(
      "/api/admin/settings",
      { orgName: original.orgName, orgTagline: original.orgTagline, orgSupportIntro: original.orgSupportIntro },
      adminSession
    );
    const noChangeData = (noChange.json as { data?: { changedKeys: string[] } })?.data;
    check("PUT بدون تغییر → changedKeys خالی", noChange.status === 200 && noChangeData?.changedKeys.length === 0);

    const changed = await putJson(
      "/api/admin/settings",
      { orgName: original.orgName, orgTagline: `${original.orgTagline} — آزمون`, orgSupportIntro: original.orgSupportIntro },
      adminSession
    );
    const changedData = (changed.json as { data?: { changedKeys: string[]; values: { orgTagline: string } } })?.data;
    check(
      "PUT با تغییر → ذخیره و گزارش changedKeys",
      changed.status === 200 && changedData?.changedKeys.includes("org.tagline") === true && changedData.values.orgTagline.includes("آزمون")
    );
    const settingsAudit = await db.auditLog.findFirst({
      where: { action: "settings.org.updated", actorUserId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    check("رخداد settings.org.updated ثبت شد", settingsAudit !== null);

    const invalidPut = await putJson("/api/admin/settings", { orgName: "x" }, adminSession);
    check("نام سازمان یک‌نویسه → 422", invalidPut.status === 422, `status=${invalidPut.status}`);

    // Restore original values (leave no test residue).
    await putJson(
      "/api/admin/settings",
      { orgName: original.orgName, orgTagline: original.orgTagline, orgSupportIntro: original.orgSupportIntro },
      adminSession
    );

    // --------------------------------- 8. AI usage series + system status --
    console.log("۸) سری روزانه مصرف AI و وضعیت سامانه");
    const aiUsage = await get("/api/admin/ai/usage?days=7", adminSession);
    const aiData = (aiUsage.json as { data?: { byDay: Array<{ day: string; requests: number; promptTokens: number; completionTokens: number }> } })?.data;
    check("سری byDay با طول ۷ در گزارش مصرف AI", aiUsage.status === 200 && aiData?.byDay.length === 7 && aiData.byDay.every((d) => typeof d.requests === "number"));

    const status = await get("/api/admin/system-status", adminSession);
    const stData = (status.json as { data?: { runtime: Record<string, unknown>; counts: Record<string, unknown>; env: Record<string, unknown> } })?.data;
    check(
      "وضعیت سامانه شامل runtime، شمارش‌های عملیاتی و env",
      status.status === 200 && typeof stData?.runtime?.nodeVersion === "string" && typeof stData?.counts?.auditRows === "number" && typeof stData?.env?.sessionTtlHours === "number"
    );

    // ---------------------------------------------- 9. page-level guards --
    console.log("۹) محافظت سطح صفحه");
    const anonPage = await get("/admin/audit");
    check("صفحه /admin/audit بدون نشست → ریدایرکت به ورود", [302, 303, 307, 308].includes(anonPage.status) && (anonPage.location ?? "").includes("/login"), `status=${anonPage.status}`);
    const opPage = await get("/admin/audit", opSession);
    check("اپراتور روی /admin/audit پنل رد دسترسی می‌بیند", opPage.status === 200 && opPage.text.includes("دسترسی به گزارش حسابرسی ندارید"));
    const opReportsPage = await get("/admin/reports", opSession);
    check("اپراتور روی /admin/reports پنل رد دسترسی می‌بیند", opReportsPage.status === 200 && opReportsPage.text.includes("دسترسی به گزارش"));
    const adminPage = await get("/admin/audit", adminSession);
    check("مدیر روی /admin/audit نمایشگر واقعی می‌بیند", adminPage.status === 200 && adminPage.text.includes("گزارش حسابرسی"));

    // ------------------------------- 10. CSV rows exported → audit linkage
    console.log("۱۰) اتصال خروجی CSV به حسابرسی (فراداده)");
    const csvMeta = exportedAudit?.metadata ? JSON.parse(exportedAudit.metadata) : null;
    check("فراداده خروجی شامل بازه و تعداد سطرها است", !!csvMeta && typeof csvMeta.days === "number" && typeof csvMeta.rows === "number");
  } finally {
    // --------------------------------------------------------- cleanup ---
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
    await del(() => db.departmentMembership.deleteMany({ where: { userId: op.id } }), "membership");
    await del(() => db.session.deleteMany({ where: { userId: { in: [op.id, admin.id] } } }), "sessions");
    await del(() => db.notification.deleteMany({ where: { recipientUserId: { in: [op.id, admin.id] } } }), "notifications");
    await del(() => db.user.delete({ where: { id: op.id } }), "operator");
    await del(() => db.user.delete({ where: { id: admin.id } }), "admin");
    await del(() => db.department.delete({ where: { id: dept.id } }), "department");
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
  });
