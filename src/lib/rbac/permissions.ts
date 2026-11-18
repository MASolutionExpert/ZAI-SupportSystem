/**
 * Permission catalog — the single source of truth for action-level RBAC keys.
 * Deny-by-default: a user has exactly the permissions bound to their role(s)
 * plus their per-user overrides (ALLOW/DENY) — nothing else.
 *
 * Permissions marked with `enforcedInPhase` are wired to real guards when the
 * corresponding module ships; the catalog is seeded from day one so role
 * bindings survive future upgrades (SUPER_ADMIN auto-syncs to all keys).
 */

export const PERMISSION_CATEGORY_LABELS = {
  ADMIN: "مدیریت سامانه",
  SUPPORT: "میز پشتیبانی",
  FILES: "فایل‌های مشترک",
  KB: "مخزن دانش",
  AI: "دستیار هوشمند",
} as const;

export type PermissionCategory = keyof typeof PERMISSION_CATEGORY_LABELS;

export type PermissionDef = {
  key: string;
  category: PermissionCategory;
  description: string;
};

export const PERMISSION_CATALOG: PermissionDef[] = [
  // ------------------------------------------------------------- ADMIN ----
  { key: "admin.dashboard.view", category: "ADMIN", description: "مشاهده داشبورد مدیریت سامانه" },
  { key: "admin.users.manage", category: "ADMIN", description: "مدیریت کاربران و اپراتورها" },
  { key: "admin.citizens.manage", category: "ADMIN", description: "مدیریت کاربران سامانه (مراجعان): ویرایش، بازنشانی رمز، مسدودسازی، حذف" },
  { key: "admin.departments.manage", category: "ADMIN", description: "مدیریت دپارتمان‌ها" },
  { key: "admin.roles.manage", category: "ADMIN", description: "مدیریت نقش‌ها" },
  { key: "admin.permissions.manage", category: "ADMIN", description: "مدیریت مجوزها و استثناهای کاربر" },
  { key: "admin.settings.manage", category: "ADMIN", description: "مدیریت تنظیمات سامانه" },
  { key: "admin.storage.manage", category: "ADMIN", description: "مدیریت فضای ذخیره‌سازی و سهمیه‌ها" },
  { key: "admin.audit.view", category: "ADMIN", description: "مشاهده گزارش حسابرسی" },
  { key: "admin.reports.view", category: "ADMIN", description: "مشاهده گزارش‌های مدیریتی (تیکت، اپراتور، تخصیص)" },
  { key: "admin.integrations.manage", category: "ADMIN", description: "مدیریت یکپارچه‌سازی‌ها" },
  { key: "admin.backups.manage", category: "ADMIN", description: "مدیریت پشتیبان‌گیری و بازیابی" },

  // ----------------------------------------------------------- SUPPORT ----
  { key: "tickets.view", category: "SUPPORT", description: "مشاهده تیکت‌ها" },
  { key: "tickets.view.all", category: "SUPPORT", description: "مشاهده همه تیکت‌های سامانه" },
  { key: "tickets.view.department", category: "SUPPORT", description: "مشاهده تیکت‌های دپارتمان خود" },
  { key: "tickets.create.internal", category: "SUPPORT", description: "ایجاد تیکت به‌صورت داخلی" },
  { key: "tickets.reply", category: "SUPPORT", description: "پاسخ به تیکت‌ها" },
  { key: "tickets.notes.add", category: "SUPPORT", description: "افزودن یادداشت داخلی" },
  { key: "tickets.status.change", category: "SUPPORT", description: "تغییر وضعیت تیکت" },
  { key: "tickets.assign", category: "SUPPORT", description: "ارجاع تیکت به اپراتور" },
  { key: "tickets.transfer", category: "SUPPORT", description: "انتقال تیکت بین دپارتمان‌ها" },
  { key: "tickets.customer.history.view", category: "SUPPORT", description: "مشاهده سابقه مراجعه مراجعان" },
  { key: "tickets.export", category: "SUPPORT", description: "خروجی گرفتن از داده تیکت‌ها" },
  { key: "tickets.delete", category: "SUPPORT", description: "حذف یا آرشیو تیکت‌ها (نیازمند مجوز صریح)" },

  // ------------------------------------------------------------- FILES ----
  { key: "files.access", category: "FILES", description: "دسترسی به فضای کاری فایل‌های مشترک" },
  { key: "files.view", category: "FILES", description: "مشاهده فایل‌ها و پوشه‌ها" },
  { key: "files.download", category: "FILES", description: "دانلود فایل‌ها" },
  { key: "files.upload", category: "FILES", description: "بارگذاری فایل" },
  { key: "files.folders.create", category: "FILES", description: "ایجاد پوشه" },
  { key: "files.rename", category: "FILES", description: "تغییر نام پوشه یا فایل" },
  { key: "files.metadata.edit", category: "FILES", description: "ویرایش اطلاعات فایل" },
  { key: "files.replace", category: "FILES", description: "جایگزینی نسخه فایل" },
  { key: "files.move", category: "FILES", description: "انتقال فایل بین پوشه‌ها" },
  { key: "files.delete", category: "FILES", description: "حذف فایل یا پوشه" },
  { key: "files.department.manage", category: "FILES", description: "مدیریت فایل‌های دپارتمان خود" },
  { key: "files.all.manage", category: "FILES", description: "مدیریت فایل‌های همه دپارتمان‌ها" },
  { key: "files.quotas.manage", category: "FILES", description: "مدیریت سهمیه فضای کاربران و دپارتمان‌ها" },

  // ---------------------------------------------------------------- KB ----
  { key: "kb.access", category: "KB", description: "دسترسی به مخزن دانش" },
  { key: "kb.view", category: "KB", description: "مشاهده محتوای مخزن دانش" },
  { key: "kb.qa.create", category: "KB", description: "ایجاد پرسش و پاسخ رسمی" },
  { key: "kb.qa.edit", category: "KB", description: "ویرایش پرسش و پاسخ" },
  { key: "kb.qa.publish", category: "KB", description: "انتشار یا لغو انتشار محتوا" },
  { key: "kb.documents.upload", category: "KB", description: "بارگذاری سند سازمانی" },
  { key: "kb.documents.delete", category: "KB", description: "حذف سند و داده‌های فهرست‌شده آن" },
  { key: "kb.documents.reprocess", category: "KB", description: "پردازش مجدد سند" },
  { key: "kb.collections.manage", category: "KB", description: "مدیریت مجموعه‌های دانش" },
  { key: "kb.departments.assign", category: "KB", description: "انتساب دانش به دپارتمان‌ها" },

  // ---------------------------------------------------------------- AI ----
  { key: "ai.settings.access", category: "AI", description: "دسترسی به تنظیمات هوش مصنوعی" },
  { key: "ai.provider.configure", category: "AI", description: "پیکربندی ارائه‌دهنده سرویس AI" },
  { key: "ai.credentials.update", category: "AI", description: "به‌روزرسانی کلیدهای API" },
  { key: "ai.models.select", category: "AI", description: "انتخاب مدل گفتگو و امبدینگ" },
  { key: "ai.connection.test", category: "AI", description: "تست اتصال به سرویس AI" },
  { key: "ai.department.settings.manage", category: "AI", description: "پیکربندی AI برای هر دپارتمان" },
  { key: "ai.usage.view", category: "AI", description: "مشاهده گزارش مصرف AI" },
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

export const CATEGORY_ORDER: PermissionCategory[] = [
  "ADMIN",
  "SUPPORT",
  "FILES",
  "KB",
  "AI",
];
