import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from "@/lib/rbac/permissions";
import { audit } from "@/lib/audit";

/**
 * Idempotent system bootstrap.
 *
 *  1. Seeds the permission catalog (upsert by key).
 *  2. Seeds the three system roles and re-syncs SUPER_ADMIN bindings to ALL
 *     catalog keys (so newly shipped permissions arrive with upgrades).
 *  3. Creates the initial Super Admin ONLY when no super admin account
 *     exists — never overwrites or recreates existing accounts
 *     (master spec 9.1 / 15). The bootstrap password must satisfy the
 *     password policy and the account is flagged mustChangePassword.
 *
 * Safe to call on every server start; safe to run concurrently.
 */

export type BootstrapReport = {
  permissionsSeeded: number;
  rolesSeeded: number;
  superAdminCreated: boolean;
  superAdminSkipped: boolean;
};

export async function runBootstrap(): Promise<BootstrapReport> {
  const report: BootstrapReport = {
    permissionsSeeded: 0,
    rolesSeeded: 0,
    superAdminCreated: false,
    superAdminSkipped: false,
  };

  // ------------------------------------------------ 1. Permission catalog --
  for (const permission of PERMISSION_CATALOG) {
    await db.permission.upsert({
      where: { key: permission.key },
      update: { category: permission.category, description: permission.description },
      create: {
        key: permission.key,
        category: permission.category,
        description: permission.description,
      },
    });
    report.permissionsSeeded += 1;
  }

  // ------------------------------------------------------- 2. System roles --
  const roleDefs = [
    {
      key: "SUPER_ADMIN",
      name: "مدیر ارشد سامانه",
      description: "دسترسی کامل به همه بخش‌ها و تنظیمات",
      isSystem: true,
    },
    {
      key: "OPERATOR",
      name: "اپراتور پشتیبانی",
      description: "پاسخ‌گویی به تیکت‌ها و مدیریت فایل‌های دپارتمان",
      isSystem: true,
    },
    {
      key: "FILE_MANAGER",
      name: "مدیر فایل‌های مشترک",
      description: "مدیریت کامل فضای فایل‌های مشترک",
      isSystem: true,
    },
  ];

  for (const role of roleDefs) {
    await db.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: role,
    });
    report.rolesSeeded += 1;
  }

  // Baseline role bindings (OPERATOR / FILE_MANAGER). SUPER_ADMIN is bound to
  // every catalog key below.
  const operatorBaseline = [
    "tickets.view",
    "tickets.view.department",
    "tickets.reply",
    "tickets.notes.add",
    "tickets.status.change",
    "files.access",
    "files.view",
    "files.download",
    "files.upload",
    "kb.view",
  ];
  const fileManagerBaseline = PERMISSION_CATALOG.filter(
    (p) => p.category === "FILES"
  ).map((p) => p.key);

  async function ensureBindings(roleKey: string, keys: string[]) {
    for (const key of keys) {
      await db.rolePermission.upsert({
        where: {
          roleKey_permissionKey: { roleKey, permissionKey: key },
        },
        update: {},
        create: { roleKey, permissionKey: key },
      });
    }
  }

  await ensureBindings("OPERATOR", operatorBaseline);
  await ensureBindings("FILE_MANAGER", fileManagerBaseline);
  await ensureBindings("SUPER_ADMIN", ALL_PERMISSION_KEYS);

  // ------------------------------------------ 3. Initial super admin account --
  const existingSuperAdmin = await db.user.findFirst({
    where: { roleKey: "SUPER_ADMIN" },
  });

  if (existingSuperAdmin) {
    report.superAdminSkipped = true;
    return report;
  }

  const env = getEnv();
  const username = env.SUPERADMIN_USERNAME.trim().toLowerCase();
  const password = env.SUPERADMIN_PASSWORD;

  if (!password) {
    console.warn(
      "[bootstrap] SUPERADMIN_PASSWORD is not set — skipping super admin creation. " +
        "Set SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD, then run `bun run bootstrap`."
    );
    report.superAdminSkipped = true;
    return report;
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    console.warn(
      "[bootstrap] SUPERADMIN_PASSWORD does not satisfy the password policy " +
        "(>=12 chars with upper+lower+digit) — skipping super admin creation."
    );
    report.superAdminSkipped = true;
    return report;
  }

  const passwordHash = await hashPassword(password);

  try {
    const superAdmin = await db.user.create({
      data: {
        username,
        name: "مدیر ارشد سامانه",
        passwordHash,
        roleKey: "SUPER_ADMIN",
        status: "ACTIVE",
        mustChangePassword: true,
      },
    });
    report.superAdminCreated = true;

    await audit({
      actorType: "SYSTEM",
      action: "system.bootstrap.superadmin",
      entityType: "user",
      entityId: superAdmin.id,
      metadata: { username, forcedPasswordChange: true },
    });
  } catch (error) {
    // Unique violation → another process created it concurrently; fine.
    console.warn("[bootstrap] super admin creation skipped:", error);
    report.superAdminSkipped = true;
  }

  return report;
}

/**
 * Seed default organizational settings (only when absent — never overwrite
 * values an administrator has already customized).
 */
export async function ensureDefaultSettings(): Promise<void> {
  const defaults: Array<[string, string]> = [
    ["org.name", "سامانه پشتیبانی سازمان"],
    ["org.tagline", "پاسخگویی سریع، دقیق و محرمانه"],
    [
      "org.supportIntro",
      "یک دپارتمان را انتخاب کنید تا گفتگو را آغاز کنید؛ دستیار هوشمند یا اپراتورهای ما پاسخگوی شما هستند.",
    ],
  ];
  for (const [key, value] of defaults) {
    await db.systemSetting.upsert({
      where: { key },
      update: {}, // exists → keep the administrator's value untouched
      create: { key, value: JSON.stringify(value), updatedBy: "system" },
    });
  }
}
