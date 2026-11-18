import "server-only";

import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";
import { getStorageDriver, ensureStorageRoot } from "@/lib/storage";
import { hasDepartmentAccess, resolveDepartmentScope } from "@/lib/rbac/scope";
import { can } from "@/lib/rbac/service";
import type { SessionUser } from "@/lib/auth/session";
import { verifyContentType, storageKeyExtension } from "./mime";
import { getStorageSettings, getAvSettings } from "./settings";
import { scanBuffer } from "./scan";
import { FILES_SUBFOLDER, MAX_FILES_PER_UPLOAD } from "./types";
import type {
  FilesListing,
  SharedFileView,
  SharedFolderView,
  BreadcrumbEntry,
  QuotaCheck,
  ResolvedQuotas,
  ScanOutcome,
} from "./types";
import { FilesInputError, FilesScopeError } from "./types";

/**
 * Shared File Hub service (Phase 5) — department-scoped, permission-gated,
 * audited file operations over the storage driver (spec §8.3, §10, §14).
 *
 * Authorization model:
 *  - Capability from RBAC permission keys (files.*).
 *  - Scope from department membership or the global-scope key
 *    `files.all.manage` — re-checked on EVERY operation server-side.
 */

const driver = () => getStorageDriver();

// ------------------------------------------------------- scope helpers ----

async function assertDepartmentScope(userId: string, departmentId: string): Promise<void> {
  const allowed = await hasDepartmentAccess(userId, departmentId);
  if (!allowed) {
    throw new FilesScopeError("به فضای فایل این دپارتمان دسترسی ندارید.", 403);
  }
}

/** Departments the user may browse (for the department selector). */
export async function listFilesDepartmentsInScope(userId: string) {
  const scope = await resolveDepartmentScope(userId);
  const departments = await db.department.findMany({
    where: scope.all ? { isActive: true } : { isActive: true, id: { in: scope.departmentIds } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, storageQuotaBytes: true, operatorQuotaBytes: true },
  });
  return { scopeAll: scope.all, departments };
}

// ------------------------------------------------------------ quotas -------

async function usageFor(where: { departmentId?: string; uploadedById?: string }): Promise<number> {
  const agg = await db.sharedFile.aggregate({
    where,
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

async function resolveQuotas(
  userId: string,
  departmentId: string
): Promise<ResolvedQuotas> {
  const [settings, department, user] = await Promise.all([
    getStorageSettings(),
    db.department.findUnique({
      where: { id: departmentId },
      select: { storageQuotaBytes: true, operatorQuotaBytes: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true },
    }),
  ]);

  const [totalUsed, departmentUsed, operatorUsed] = await Promise.all([
    usageFor({}),
    usageFor({ departmentId }),
    usageFor({ uploadedById: userId }),
  ]);

  return {
    totalCapacityBytes: settings.totalCapacityBytes,
    departmentQuotaBytes: department?.storageQuotaBytes ?? settings.defaultDepartmentQuotaBytes,
    operatorQuotaBytes:
      user?.storageQuotaBytes ?? department?.operatorQuotaBytes ?? settings.defaultOperatorQuotaBytes,
    totalUsedBytes: totalUsed,
    departmentUsedBytes: departmentUsed,
    operatorUsedBytes: operatorUsed,
  };
}

/**
 * Check all three quota levels (global capacity / department / operator) for
 * an incoming delta. Fail-closed with an honest, actionable Persian message.
 */
async function checkQuotas(
  userId: string,
  departmentId: string,
  incomingBytes: number
): Promise<QuotaCheck> {
  const quotas = await resolveQuotas(userId, departmentId);

  if (quotas.totalUsedBytes + incomingBytes > quotas.totalCapacityBytes) {
    return { ok: false, error: "ظرفیت کل ذخیره‌سازی سامانه تکمیل است؛ با مدیر سامانه تماس بگیرید." };
  }
  if (quotas.departmentUsedBytes + incomingBytes > quotas.departmentQuotaBytes) {
    return { ok: false, error: "سهمیه فضای دپارتمان تکمیل است؛ فضای کمتری نسبت به حجم فایل باقی مانده است." };
  }
  if (quotas.operatorUsedBytes + incomingBytes > quotas.operatorQuotaBytes) {
    return { ok: false, error: "سهمیه فضای شما تکمیل است؛ فایل‌های قدیمی‌تر خود را حذف کنید یا با مدیر تماس بگیرید." };
  }
  return { ok: true, quotas };
}

// ---------------------------------------------------------- validation ----

const FOLDER_NAME_MAX = 80;

function validateEntryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new FilesInputError("نام نمی‌تواند خالی باشد.");
  if (trimmed.length > FOLDER_NAME_MAX) {
    throw new FilesInputError(`نام نمی‌تواند بیش از ${FOLDER_NAME_MAX} نویسه باشد.`);
  }
  // No path separators or control characters — names are display-only labels.
   
  if (/[\\/]/.test(trimmed) || /[\x00-\x1f]/.test(trimmed)) {
    throw new FilesInputError("نام نمی‌تواند شامل کاراکترهای مسیر یا کنترلی باشد.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new FilesInputError("این نام مجاز نیست.");
  }
  return trimmed;
}

// ------------------------------------------------------------- listing ----

export async function listFiles(
  user: SessionUser,
  departmentId: string,
  folderId: string | null
): Promise<FilesListing> {
  await assertDepartmentScope(user.id, departmentId);
  const canView = await can(user.id, "files.view");
  if (!canView) throw new FilesScopeError("دسترسی مشاهده فایل‌ها را ندارید.", 403);

  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, storageQuotaBytes: true, operatorQuotaBytes: true },
  });
  if (!department) throw new FilesInputError("دپارتمان یافت نشد.", 404);

  // Folder (when provided) must belong to the same department.
  if (folderId) {
    const folder = await db.sharedFolder.findUnique({
      where: { id: folderId },
      select: { id: true, departmentId: true },
    });
    if (!folder || folder.departmentId !== departmentId) {
      throw new FilesInputError("پوشه یافت نشد.", 404);
    }
  }

  const [folders, files, settings, av] = await Promise.all([
    db.sharedFolder.findMany({
      where: { departmentId, parentId: folderId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { children: true, files: true } },
      },
    }),
    db.sharedFile.findMany({
      where: { departmentId, folderId },
      orderBy: { updatedAt: "desc" },
      include: { uploader: { select: { name: true } } },
    }),
    getStorageSettings(),
    getAvSettings(),
  ]);

  // Breadcrumb (root → current folder).
  const breadcrumb: BreadcrumbEntry[] = [];
  if (folderId) {
    const chain: Array<{ id: string; name: string }> = [];
    let currentId: string | null = folderId;
    let guard = 0;
    while (currentId && guard < 32) {
      const f = await db.sharedFolder.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, parentId: true, departmentId: true },
      });
      if (!f || f.departmentId !== departmentId) break; // scope break — stop honestly
      chain.unshift({ id: f.id, name: f.name });
      currentId = f.parentId;
      guard += 1;
    }
    breadcrumb.push({ id: null, name: "ریشه" });
    for (const entry of chain) breadcrumb.push({ id: entry.id, name: entry.name });
  } else {
    breadcrumb.push({ id: null, name: "ریشه" });
  }

  const quotas = await resolveQuotas(user.id, departmentId);

  const folderViews: SharedFolderView[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    createdAt: f.createdAt.toISOString(),
    childrenCount: f._count.children,
    fileCount: f._count.files,
  }));

  const fileViews: SharedFileView[] = files.map((f) => ({
    id: f.id,
    name: f.name,
    folderId: f.folderId,
    sizeBytes: f.sizeBytes,
    mimeType: f.mimeType,
    version: f.version,
    scanStatus: f.scanStatus,
    uploaderName: f.uploader?.name ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  }));

  return {
    department: { id: department.id, name: department.name },
    folders: folderViews,
    files: fileViews,
    breadcrumb,
    usage: {
      departmentUsedBytes: quotas.departmentUsedBytes,
      departmentQuotaBytes: quotas.departmentQuotaBytes,
      operatorUsedBytes: quotas.operatorUsedBytes,
      operatorQuotaBytes: quotas.operatorQuotaBytes,
      totalUsedBytes: quotas.totalUsedBytes,
      totalCapacityBytes: quotas.totalCapacityBytes,
    },
    avProvider: av.provider,
  };
}

// ------------------------------------------------------------- folders ----

export async function createFolder(
  user: SessionUser,
  departmentId: string,
  parentId: string | null,
  rawName: string
): Promise<SharedFolderView> {
  const allowed = await can(user.id, "files.folders.create");
  if (!allowed) throw new FilesScopeError("دسترسی ایجاد پوشه را ندارید.", 403);
  await assertDepartmentScope(user.id, departmentId);

  const name = validateEntryName(rawName);

  if (parentId) {
    const parent = await db.sharedFolder.findUnique({
      where: { id: parentId },
      select: { id: true, departmentId: true },
    });
    if (!parent || parent.departmentId !== departmentId) {
      throw new FilesInputError("پوشه والد یافت نشد.", 404);
    }
  }

  const duplicate = await db.sharedFolder.findFirst({
    where: { departmentId, parentId, name },
    select: { id: true },
  });
  if (duplicate) throw new FilesInputError("پوشه‌ای با همین نام در این مسیر وجود دارد.");

  const folder = await db.sharedFolder.create({
    data: { departmentId, parentId, name, createdById: user.id },
  });

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "folder.created",
    entityType: "sharedFolder",
    entityId: folder.id,
    metadata: { departmentId, parentId, name },
  });

  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt.toISOString(),
    childrenCount: 0,
    fileCount: 0,
  };
}

export async function renameFolder(
  user: SessionUser,
  folderId: string,
  rawName: string
): Promise<void> {
  const allowed = await can(user.id, "files.rename");
  if (!allowed) throw new FilesScopeError("دسترسی تغییر نام را ندارید.", 403);

  const name = validateEntryName(rawName);
  const folder = await db.sharedFolder.findUnique({ where: { id: folderId } });
  if (!folder) throw new FilesInputError("پوشه یافت نشد.", 404);
  await assertDepartmentScope(user.id, folder.departmentId);

  const duplicate = await db.sharedFolder.findFirst({
    where: { departmentId: folder.departmentId, parentId: folder.parentId, name, id: { not: folderId } },
    select: { id: true },
  });
  if (duplicate) throw new FilesInputError("پوشه‌ای با همین نام در این مسیر وجود دارد.");

  await db.sharedFolder.update({ where: { id: folderId }, data: { name } });

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "folder.renamed",
    entityType: "sharedFolder",
    entityId: folderId,
    metadata: { from: folder.name, to: name, departmentId: folder.departmentId },
  });
}

/** Move a folder (and its subtree) to another parent INSIDE the same department. */
export async function moveFolder(
  user: SessionUser,
  folderId: string,
  newParentId: string | null
): Promise<void> {
  const allowed = await can(user.id, "files.move");
  if (!allowed) throw new FilesScopeError("دسترسی انتقال را ندارید.", 403);

  const folder = await db.sharedFolder.findUnique({ where: { id: folderId } });
  if (!folder) throw new FilesInputError("پوشه یافت نشد.", 404);
  await assertDepartmentScope(user.id, folder.departmentId);

  if (newParentId) {
    const parent = await db.sharedFolder.findUnique({
      where: { id: newParentId },
      select: { id: true, departmentId: true },
    });
    if (!parent || parent.departmentId !== folder.departmentId) {
      throw new FilesInputError("پوشه مقصد باید در همان دپارتمان باشد.", 422);
    }
    // Cycle guard: new parent must not be the folder itself or a descendant.
    let cursor: string | null = newParentId;
    let guard = 0;
    while (cursor && guard < 64) {
      if (cursor === folderId) {
        throw new FilesInputError("انتقال پوشه به داخل خودش مجاز نیست.");
      }
      const f = await db.sharedFolder.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = f?.parentId ?? null;
      guard += 1;
    }
  }

  const duplicate = await db.sharedFolder.findFirst({
    where: { departmentId: folder.departmentId, parentId: newParentId, name: folder.name, id: { not: folderId } },
    select: { id: true },
  });
  if (duplicate) throw new FilesInputError("پوشه‌ای با همین نام در مقصد وجود دارد.");

  await db.sharedFolder.update({ where: { id: folderId }, data: { parentId: newParentId } });

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "folder.moved",
    entityType: "sharedFolder",
    entityId: folderId,
    metadata: { from: folder.parentId, to: newParentId, departmentId: folder.departmentId },
  });
}

/** Delete a folder subtree — DB cascade removes files; blobs removed best-effort. */
export async function deleteFolder(user: SessionUser, folderId: string): Promise<void> {
  const allowed = await can(user.id, "files.delete");
  if (!allowed) throw new FilesScopeError("دسترسی حذف را ندارید.", 403);

  const folder = await db.sharedFolder.findUnique({ where: { id: folderId } });
  if (!folder) throw new FilesInputError("پوشه یافت نشد.", 404);
  await assertDepartmentScope(user.id, folder.departmentId);

  // Collect descendant folders (for blob cleanup after cascade delete).
  const descendants: string[] = [];
  const queue: string[] = [folderId];
  let guard = 0;
  while (queue.length > 0 && guard < 512) {
    const current = queue.shift()!;
    const children = await db.sharedFolder.findMany({
      where: { parentId: current },
      select: { id: true },
    });
    for (const c of children) {
      descendants.push(c.id);
      queue.push(c.id);
    }
    guard += 1;
  }

  const affected = await db.sharedFile.findMany({
    where: { folderId: { in: [folderId, ...descendants] } },
    select: { storageKey: true, id: true },
  });

  await db.sharedFile.deleteMany({ where: { folderId: { in: [folderId, ...descendants] } } });
  await db.sharedFolder.delete({ where: { id: folderId } }); // cascades subtree folders

  for (const f of affected) {
    await driver().delete(f.storageKey);
  }

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "folder.deleted",
    entityType: "sharedFolder",
    entityId: folderId,
    metadata: { name: folder.name, departmentId: folder.departmentId, filesRemoved: affected.length },
  });
}

// -------------------------------------------------------------- upload ----

export type UploadInputFile = { filename: string; buffer: Buffer };

export type UploadResult =
  | { ok: true; uploaded: SharedFileView[] }
  | { ok: false; error: string };

/**
 * Batch upload — all-or-nothing: every file in the batch is validated
 * (extension allowlist → content MIME → size → cumulative quota → AV scan)
 * BEFORE anything is stored; a single failure aborts the whole batch with an
 * honest per-file error, so quota accounting never goes partially consumed.
 */
export async function uploadFiles(
  user: SessionUser,
  departmentId: string,
  folderId: string | null,
  inputs: UploadInputFile[]
): Promise<UploadResult> {
  const allowed = await can(user.id, "files.upload");
  if (!allowed) throw new FilesScopeError("دسترسی بارگذاری را ندارید.", 403);
  await assertDepartmentScope(user.id, departmentId);

  if (inputs.length === 0) {
    return { ok: false, error: "هیچ فایلی برای بارگذاری ارسال نشده است." };
  }
  if (inputs.length > MAX_FILES_PER_UPLOAD) {
    return { ok: false, error: `حداکثر ${MAX_FILES_PER_UPLOAD} فایل در هر بار ثبت.` };
  }

  if (folderId) {
    const folder = await db.sharedFolder.findUnique({
      where: { id: folderId },
      select: { id: true, departmentId: true },
    });
    if (!folder || folder.departmentId !== departmentId) {
      throw new FilesInputError("پوشه مقصد یافت نشد.", 404);
    }
  }

  const settings = await getStorageSettings();
  const av = await getAvSettings();

  // ---------------------------------------- 1. validate every file first --
  const totalIncoming = inputs.reduce((sum, f) => sum + f.buffer.length, 0);
  for (const input of inputs) {
    if (input.buffer.length > settings.maxUploadBytes) {
      return {
        ok: false,
        error: `حجم «${input.filename}» بیش از حد مجاز (${Math.floor(settings.maxUploadBytes / (1024 * 1024))} مگابایت) است.`,
      };
    }
    const mime = verifyContentType(input.filename, input.buffer, settings.allowedExtensions);
    if (!mime.ok) {
      return { ok: false, error: `«${input.filename}»: ${mime.error}` };
    }
  }

  // Duplicate names within the batch or against existing entries.
  const batchNames = new Set<string>();
  for (const input of inputs) {
    const name = input.filename.trim();
    if (batchNames.has(name)) {
      return { ok: false, error: `نام تکراری در این بارگذاری: «${name}».` };
    }
    batchNames.add(name);
    const duplicate = await db.sharedFile.findFirst({
      where: { departmentId, folderId, name },
      select: { id: true },
    });
    if (duplicate) {
      return { ok: false, error: `فایلی با نام «${name}» در این پوشه وجود دارد.` };
    }
  }

  // ------------------------------------------------ 2. quota (cumulative) --
  const quota = await checkQuotas(user.id, departmentId, totalIncoming);
  if (!quota.ok) return { ok: false, error: quota.error };

  // ------------------------------------------------ 3. AV scan (mandatory) --
  for (const input of inputs) {
    const outcome: ScanOutcome = await scanBuffer(input.buffer, av);
    if (outcome.verdict === "INFECTED") {
      // Bytes are never stored; every infected attempt is audited.
      await audit({
        actorType: "USER",
        actorUserId: user.id,
        actorLabel: user.username,
        action: "file.scan.infected",
        entityType: "sharedFile",
        metadata: { departmentId, folderId, filename: input.filename.slice(0, 120), signature: outcome.signature.slice(0, 120) },
      });
      return { ok: false, error: `فایل «${input.filename}» آلوده تشخیص داده شد (${outcome.signature}) و ذخیره نشد.` };
    }
    if (outcome.verdict === "SCAN_ERROR") {
      await audit({
        actorType: "USER",
        actorUserId: user.id,
        actorLabel: user.username,
        action: "file.scan.error",
        entityType: "sharedFile",
        metadata: { departmentId, folderId, filename: input.filename.slice(0, 120), error: outcome.error.slice(0, 200) },
      });
      return {
        ok: false,
        error: `اسکن امنیتی «${input.filename}» ناموفق بود (${outcome.error})؛ با فعال‌بودن اسکن اجباری، فایل بدون اسکن ذخیره نمی‌شود.`,
      };
    }
  }

  // ------------------------------------------- 4. store all + DB records --
  await ensureStorageRoot(FILES_SUBFOLDER);
  const storedKeys: string[] = [];
  const created: SharedFileView[] = [];

  try {
    for (const input of inputs) {
      const mime = verifyContentType(input.filename, input.buffer, settings.allowedExtensions);
      if (!mime.ok) throw new FilesInputError(mime.error); // unreachable (pre-validated)
      const checksum = sha256Hex(input.buffer);
      const storageKey = `${FILES_SUBFOLDER}/${Date.now().toString(36)}-${randomBytes(16).toString("hex")}.${storageKeyExtension(mime.ext)}`;

      await driver().put(storageKey, input.buffer);
      storedKeys.push(storageKey);

      const record = await db.sharedFile.create({
        data: {
          departmentId,
          folderId,
          name: input.filename.trim(),
          storageKey,
          mimeType: mime.mimeType,
          sizeBytes: input.buffer.length,
          checksum,
          version: 1,
          scanStatus: av.provider === "none" ? "SKIPPED" : "CLEAN",
          uploadedById: user.id,
        },
        include: { uploader: { select: { name: true } } },
      });

      await audit({
        actorType: "USER",
        actorUserId: user.id,
        actorLabel: user.username,
        action: "file.uploaded",
        entityType: "sharedFile",
        entityId: record.id,
        metadata: {
          departmentId,
          folderId,
          name: record.name.slice(0, 120),
          sizeBytes: record.sizeBytes,
          mimeType: record.mimeType,
          scanStatus: record.scanStatus,
        },
      });

      created.push({
        id: record.id,
        name: record.name,
        folderId: record.folderId,
        sizeBytes: record.sizeBytes,
        mimeType: record.mimeType,
        version: record.version,
        scanStatus: record.scanStatus,
        uploaderName: record.uploader?.name ?? null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      });
    }
  } catch (error) {
    // Roll back stored blobs so quota accounting stays truthful.
    for (const key of storedKeys) {
      await driver().delete(key);
    }
    throw error;
  }

  return { ok: true, uploaded: created };
}

// ------------------------------------------------------------- download ---

export async function getFileForDownload(
  user: SessionUser,
  fileId: string
): Promise<{ ok: true; filename: string; mimeType: string; storageKey: string } | { ok: false; error: string; status: number }> {
  const allowed = await can(user.id, "files.download");
  if (!allowed) return { ok: false, error: "دسترسی دانلود را ندارید.", status: 403 };

  const file = await db.sharedFile.findUnique({
    where: { id: fileId },
    include: { uploader: { select: { name: true } } },
  });
  if (!file) return { ok: false, error: "فایل یافت نشد.", status: 404 };

  let scopeOk = false;
  try {
    await assertDepartmentScope(user.id, file.departmentId);
    scopeOk = true;
  } catch {
    scopeOk = false;
  }
  if (!scopeOk) return { ok: false, error: "به این فایل دسترسی ندارید.", status: 403 };

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "file.downloaded",
    entityType: "sharedFile",
    entityId: file.id,
    metadata: { name: file.name.slice(0, 120), departmentId: file.departmentId },
  });

  return { ok: true, filename: file.name, mimeType: file.mimeType, storageKey: file.storageKey };
}

// ------------------------------------------------------------- replace ----

export async function replaceFile(
  user: SessionUser,
  fileId: string,
  input: UploadInputFile
): Promise<{ ok: true; file: SharedFileView } | { ok: false; error: string }> {
  const allowed = await can(user.id, "files.replace");
  if (!allowed) throw new FilesScopeError("دسترسی جایگزینی فایل را ندارید.", 403);

  const existing = await db.sharedFile.findUnique({ where: { id: fileId } });
  if (!existing) throw new FilesInputError("فایل یافت نشد.", 404);
  await assertDepartmentScope(user.id, existing.departmentId);

  const settings = await getStorageSettings();
  const av = await getAvSettings();

  if (input.buffer.length > settings.maxUploadBytes) {
    return { ok: false, error: `حجم فایل بیش از حد مجاز (${Math.floor(settings.maxUploadBytes / (1024 * 1024))} مگابایت) است.` };
  }

  // Content must still match the entry's verified type family.
  const mime = verifyContentType(input.filename, input.buffer, settings.allowedExtensions);
  if (!mime.ok) return { ok: false, error: mime.error };

  const quota = await checkQuotas(user.id, existing.departmentId, input.buffer.length - existing.sizeBytes);
  if (!quota.ok) return { ok: false, error: quota.error };

  const scan = await scanBuffer(input.buffer, av);
  if (scan.verdict === "INFECTED") {
    await audit({
      actorType: "USER",
      actorUserId: user.id,
      actorLabel: user.username,
      action: "file.scan.infected",
      entityType: "sharedFile",
      entityId: existing.id,
      metadata: { departmentId: existing.departmentId, filename: existing.name.slice(0, 120), signature: scan.signature.slice(0, 120), operation: "replace" },
    });
    return { ok: false, error: `فایل آلوده تشخیص داده شد (${scan.signature}) و جایگزین نشد.` };
  }
  if (scan.verdict === "SCAN_ERROR") {
    await audit({
      actorType: "USER",
      actorUserId: user.id,
      actorLabel: user.username,
      action: "file.scan.error",
      entityType: "sharedFile",
      entityId: existing.id,
      metadata: { departmentId: existing.departmentId, error: scan.error.slice(0, 200), operation: "replace" },
    });
    return { ok: false, error: `اسکن امنیتی ناموفق بود (${scan.error})؛ جایگزینی انجام نشد.` };
  }

  const newKey = `${FILES_SUBFOLDER}/${Date.now().toString(36)}-${randomBytes(16).toString("hex")}.${storageKeyExtension(mime.ext)}`;
  await driver().put(newKey, input.buffer);

  const updated = await db.sharedFile.update({
    where: { id: existing.id },
    data: {
      storageKey: newKey,
      mimeType: mime.mimeType,
      sizeBytes: input.buffer.length,
      checksum: sha256Hex(input.buffer),
      version: existing.version + 1,
      scanStatus: av.provider === "none" ? "SKIPPED" : "CLEAN",
      uploadedById: user.id,
    },
    include: { uploader: { select: { name: true } } },
  });

  await driver().delete(existing.storageKey); // old blob removed after success

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "file.replaced",
    entityType: "sharedFile",
    entityId: existing.id,
    metadata: {
      departmentId: existing.departmentId,
      name: updated.name.slice(0, 120),
      version: updated.version,
      oldSizeBytes: existing.sizeBytes,
      newSizeBytes: updated.sizeBytes,
    },
  });

  return {
    ok: true,
    file: {
      id: updated.id,
      name: updated.name,
      folderId: updated.folderId,
      sizeBytes: updated.sizeBytes,
      mimeType: updated.mimeType,
      version: updated.version,
      scanStatus: updated.scanStatus,
      uploaderName: updated.uploader?.name ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  };
}

// ------------------------------------------------------- rename / move ----

export async function renameFile(user: SessionUser, fileId: string, rawName: string): Promise<void> {
  const allowed = await can(user.id, "files.rename");
  if (!allowed) throw new FilesScopeError("دسترسی تغییر نام را ندارید.", 403);

  const file = await db.sharedFile.findUnique({ where: { id: fileId } });
  if (!file) throw new FilesInputError("فایل یافت نشد.", 404);
  await assertDepartmentScope(user.id, file.departmentId);

  const name = validateEntryName(rawName);
  const duplicate = await db.sharedFile.findFirst({
    where: { departmentId: file.departmentId, folderId: file.folderId, name, id: { not: fileId } },
    select: { id: true },
  });
  if (duplicate) throw new FilesInputError("فایلی با همین نام در این پوشه وجود دارد.");

  await db.sharedFile.update({ where: { id: fileId }, data: { name } });

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "file.renamed",
    entityType: "sharedFile",
    entityId: fileId,
    metadata: { from: file.name.slice(0, 120), to: name.slice(0, 120), departmentId: file.departmentId },
  });
}

export async function moveFile(user: SessionUser, fileId: string, newFolderId: string | null): Promise<void> {
  const allowed = await can(user.id, "files.move");
  if (!allowed) throw new FilesScopeError("دسترسی انتقال را ندارید.", 403);

  const file = await db.sharedFile.findUnique({ where: { id: fileId } });
  if (!file) throw new FilesInputError("فایل یافت نشد.", 404);
  await assertDepartmentScope(user.id, file.departmentId);

  if (newFolderId) {
    const folder = await db.sharedFolder.findUnique({
      where: { id: newFolderId },
      select: { id: true, departmentId: true },
    });
    if (!folder || folder.departmentId !== file.departmentId) {
      throw new FilesInputError("پوشه مقصد باید در همان دپارتمان باشد.", 422);
    }
  }

  const duplicate = await db.sharedFile.findFirst({
    where: { departmentId: file.departmentId, folderId: newFolderId, name: file.name, id: { not: fileId } },
    select: { id: true },
  });
  if (duplicate) throw new FilesInputError("فایلی با همین نام در پوشه مقصد وجود دارد.");

  await db.sharedFile.update({ where: { id: fileId }, data: { folderId: newFolderId } });

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "file.moved",
    entityType: "sharedFile",
    entityId: fileId,
    metadata: { from: file.folderId, to: newFolderId, departmentId: file.departmentId },
  });
}

// -------------------------------------------------------------- delete ----

export async function deleteFile(user: SessionUser, fileId: string): Promise<void> {
  const allowed = await can(user.id, "files.delete");
  if (!allowed) throw new FilesScopeError("دسترسی حذف را ندارید.", 403);

  const file = await db.sharedFile.findUnique({ where: { id: fileId } });
  if (!file) throw new FilesInputError("فایل یافت نشد.", 404);
  await assertDepartmentScope(user.id, file.departmentId);

  await db.sharedFile.delete({ where: { id: fileId } });
  await driver().delete(file.storageKey);

  await audit({
    actorType: "USER",
    actorUserId: user.id,
    actorLabel: user.username,
    action: "file.deleted",
    entityType: "sharedFile",
    entityId: fileId,
    metadata: { name: file.name.slice(0, 120), departmentId: file.departmentId, sizeBytes: file.sizeBytes },
  });
}

// -------------------------------------------------------------- usage -----

export type UsageReport = {
  total: { usedBytes: number; capacityBytes: number };
  departments: Array<{
    id: string;
    name: string;
    usedBytes: number;
    quotaBytes: number;
    fileCount: number;
  }>;
  operators: Array<{
    id: string;
    name: string;
    username: string;
    usedBytes: number;
    quotaBytes: number;
  }>;
};

/** Usage view — global totals (quota managers/admin) + per-department + per-operator. */
export async function getUsageReport(
  user: SessionUser,
  departmentId?: string
): Promise<UsageReport> {
  const settings = await getStorageSettings();
  const scope = await resolveDepartmentScope(user.id);

  const departmentWhere = scope.all
    ? { isActive: true }
    : { isActive: true, id: { in: scope.departmentIds } };
  const departments = await db.department.findMany({
    where: departmentId
      ? { AND: [departmentWhere, { id: departmentId }] }
      : departmentWhere,
    orderBy: { name: "asc" },
    select: { id: true, name: true, storageQuotaBytes: true, operatorQuotaBytes: true },
  });

  const totalUsed = await usageFor({});

  const perDepartment: UsageReport["departments"] = [];
  for (const d of departments) {
    const [used, count] = await Promise.all([
      usageFor({ departmentId: d.id }),
      db.sharedFile.count({ where: { departmentId: d.id } }),
    ]);
    perDepartment.push({
      id: d.id,
      name: d.name,
      usedBytes: used,
      quotaBytes: d.storageQuotaBytes ?? settings.defaultDepartmentQuotaBytes,
      fileCount: count,
    });
  }

  // Per-operator usage inside the (single) selected department or across scope.
  const departmentIds = departments.map((d) => d.id);
  const members = await db.departmentMembership.findMany({
    where: { departmentId: { in: departmentIds } },
    include: { user: { select: { id: true, name: true, username: true, storageQuotaBytes: true } } },
  });

  const seen = new Map<string, UsageReport["operators"][number]>();
  for (const m of members) {
    if (seen.has(m.user.id)) continue;
    const used = await usageFor({ uploadedById: m.user.id });
    const dept = departments.find((d) => d.id === m.departmentId);
    seen.set(m.user.id, {
      id: m.user.id,
      name: m.user.name,
      username: m.user.username,
      usedBytes: used,
      quotaBytes:
        m.user.storageQuotaBytes ?? dept?.operatorQuotaBytes ?? settings.defaultOperatorQuotaBytes,
    });
  }

  return {
    total: { usedBytes: totalUsed, capacityBytes: settings.totalCapacityBytes },
    departments: perDepartment,
    operators: Array.from(seen.values()).sort((a, b) => b.usedBytes - a.usedBytes),
  };
}

/** Public storage settings view for the settings dialog. */
export async function getStorageSettingsView() {
  const [global, av] = await Promise.all([getStorageSettings(), getAvSettings()]);
  return { global, av };
}
