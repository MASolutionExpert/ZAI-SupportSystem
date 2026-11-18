import "server-only";

/**
 * Shared File Hub (Phase 5) — types, defaults and limits (master spec §14
 * phase 5 / §8.3 / §10). All status/type fields are String in SQLite and
 * validated here with TS unions (schema convention).
 */

export const FILES_SUBFOLDER = "shared";

export const SHARED_FILE_SCAN_STATUSES = ["SKIPPED", "CLEAN"] as const;
export type SharedFileScanStatus = (typeof SHARED_FILE_SCAN_STATUSES)[number];

// ------------------------------------------------------------- defaults --

export const DEFAULT_TOTAL_CAPACITY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const DEFAULT_DEPARTMENT_QUOTA_BYTES = 512 * 1024 * 1024; // 512 MB
export const DEFAULT_OPERATOR_QUOTA_BYTES = 128 * 1024 * 1024; // 128 MB
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_FILES_PER_UPLOAD = 10;

export type StorageGlobalSettings = {
  totalCapacityBytes: number;
  defaultDepartmentQuotaBytes: number;
  defaultOperatorQuotaBytes: number;
  maxUploadBytes: number;
  /** Extension allowlist — always intersected with content-verifiable types. */
  allowedExtensions: string[];
};

export const DEFAULT_STORAGE_SETTINGS: StorageGlobalSettings = {
  totalCapacityBytes: DEFAULT_TOTAL_CAPACITY_BYTES,
  defaultDepartmentQuotaBytes: DEFAULT_DEPARTMENT_QUOTA_BYTES,
  defaultOperatorQuotaBytes: DEFAULT_OPERATOR_QUOTA_BYTES,
  maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  allowedExtensions: ["pdf", "png", "jpg", "webp", "zip", "docx", "txt", "csv"],
};

// ------------------------------------------------------- AV (ClamAV) seam --

export const AV_PROVIDER_TYPES = ["none", "clamav"] as const;
export type AvProviderType = (typeof AV_PROVIDER_TYPES)[number];

export type StorageAvSettings = {
  provider: AvProviderType;
  /** clamd TCP host (INSTREAM protocol). */
  host: string;
  port: number;
  timeoutMs: number;
};

export const DEFAULT_AV_SETTINGS: StorageAvSettings = {
  provider: "none",
  host: "127.0.0.1",
  port: 3310,
  timeoutMs: 8000,
};

export type ScanOutcome =
  | { verdict: "SKIPPED" }
  | { verdict: "CLEAN" }
  | { verdict: "INFECTED"; signature: string }
  | { verdict: "SCAN_ERROR"; error: string };

// ------------------------------------------------------- quota resolution --

export type ResolvedQuotas = {
  totalCapacityBytes: number;
  departmentQuotaBytes: number;
  operatorQuotaBytes: number;
  /** Per-quota current usage. */
  totalUsedBytes: number;
  departmentUsedBytes: number;
  operatorUsedBytes: number;
};

export type QuotaCheck =
  | { ok: true; quotas: ResolvedQuotas }
  | { ok: false; error: string };

// -------------------------------------------------------------- file view --

export type SharedFileView = {
  id: string;
  name: string;
  folderId: string | null;
  sizeBytes: number;
  mimeType: string;
  version: number;
  scanStatus: string;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SharedFolderView = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  childrenCount: number;
  fileCount: number;
};

export type BreadcrumbEntry = { id: string | null; name: string };

export type FilesListing = {
  department: { id: string; name: string };
  folders: SharedFolderView[];
  files: SharedFileView[];
  breadcrumb: BreadcrumbEntry[];
  usage: {
    departmentUsedBytes: number;
    departmentQuotaBytes: number;
    operatorUsedBytes: number;
    operatorQuotaBytes: number;
    totalUsedBytes: number;
    totalCapacityBytes: number;
  };
  avProvider: AvProviderType;
};

export class FilesInputError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 422, code?: string) {
    super(message);
    this.name = "FilesInputError";
    this.status = status;
    this.code = code;
  }
}

export class FilesScopeError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "FilesScopeError";
    this.status = status;
  }
}
