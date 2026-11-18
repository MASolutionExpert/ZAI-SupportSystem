"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Download,
  Folder,
  FolderPlus,
  HardDrive,
  Info,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Replace,
  Settings2,
  ShieldAlert,
  Trash2,
  Upload,
  FolderInput,
  Home,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { faBytes, faNum } from "@/lib/format";
import {
  StorageSettingsFields,
  StorageUsageView,
  type StorageSettingsView,
  type UsageReport,
} from "@/components/files/storage-views";

// ----------------------------------------------------------------- types --

type SharedFolderView = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  childrenCount: number;
  fileCount: number;
};

type SharedFileView = {
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

type BreadcrumbEntry = { id: string | null; name: string };

type FilesListing = {
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
  avProvider: string;
};

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.includes("pdf")) return "📕";
  if (mimeType.includes("zip")) return "🗜";
  if (mimeType.includes("wordprocessingml")) return "📄";
  if (mimeType.startsWith("text/")) return "📝";
  return "📦";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const payload = (await res.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: string }
      | null;
    if (!payload) return { ok: false, error: "پاسخ سرور نامعتبر بود." };
    if (!payload.ok) return { ok: false, error: payload.error };
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, error: "ارتباط با سرور برقرار نشد." };
  }
}

// ------------------------------------------------------------ component ---

export function FileHub({
  departments,
  canUpload,
  canDownload,
  canCreateFolder,
  canRename,
  canMove,
  canReplace,
  canDelete,
  canManageSettings,
  canViewUsage,
}: {
  scopeAll: boolean;
  departments: Array<{ id: string; name: string }>;
  canUpload: boolean;
  canDownload: boolean;
  canCreateFolder: boolean;
  canRename: boolean;
  canMove: boolean;
  canReplace: boolean;
  canDelete: boolean;
  canManageSettings: boolean;
  canViewUsage: boolean;
}) {
  const [departmentId, setDepartmentId] = useState<string>(departments[0]?.id ?? "");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [listing, setListing] = useState<FilesListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Upload dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  // Folder dialogs
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [moveFolderId, setMoveFolderId] = useState<string>("root");

  // Replace
  const [replaceTarget, setReplaceTarget] = useState<SharedFileView | null>(null);

  // Settings / usage dialogs
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<StorageSettingsView | null>(null);
  const [usageReport, setUsageReport] = useState<UsageReport | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(
    async (deptId?: string, folder?: string | null) => {
      const d = deptId ?? departmentId;
      if (!d) return;
      setLoading(true);
      setActionError(null);
      const params = new URLSearchParams({ departmentId: d, folderId: folder ?? folderId ?? "root" });
      const result = await fetchJson<FilesListing>(`/api/staff/files?${params.toString()}`);
      setLoading(false);
      if (result.ok) {
        setListing(result.data);
      } else {
        setActionError(result.error);
        setListing(null);
      }
    },
    [departmentId, folderId]
  );

  useEffect(() => {
    // Yield to a microtask before the first setState so the fetch does not
    // cascade synchronously within the effect (react-hooks/set-state-in-effect).
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load(departmentId, folderId);
    })();
    return () => {
      cancelled = true;
    };
  }, [departmentId, folderId, load]);

  const departmentName = listing?.department.name ?? departments.find((d) => d.id === departmentId)?.name ?? "";
  const canManageFolderEntries = canRename || canMove || canDelete;
  const canManageFileEntries = canReplace || canRename || canMove || canDelete;

  // ------------------------------------------------------------ actions ----

  async function handleUpload() {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    const form = new FormData();
    form.set("departmentId", departmentId);
    form.set("folderId", folderId ?? "root");
    for (const f of uploadFiles) form.append("files", f);
    const result = await fetchJson<{ uploaded: SharedFileView[] }>("/api/staff/files", {
      method: "POST",
      body: form,
    });
    setUploading(false);
    if (result.ok) {
      toast.success(`${faNum(result.data.uploaded.length)} فایل با موفقیت بارگذاری شد.`);
      setUploadOpen(false);
      setUploadFiles([]);
      void load();
    } else {
      toast.error(result.error);
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const result = await fetchJson<{ folder: SharedFolderView }>("/api/staff/files/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId, parentId: folderId, name: newFolderName.trim() }),
    });
    if (result.ok) {
      toast.success("پوشه ایجاد شد.");
      setNewFolderOpen(false);
      setNewFolderName("");
      void load();
    } else {
      toast.error(result.error);
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameValue.trim()) return;
    const url =
      renameTarget.kind === "folder"
        ? `/api/staff/files/folders/${renameTarget.id}`
        : `/api/staff/files/${renameTarget.id}`;
    const result = await fetchJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    if (result.ok) {
      toast.success("نام تغییر کرد.");
      setRenameTarget(null);
      void load();
    } else {
      toast.error(result.error);
    }
  }

  async function handleMove() {
    if (!moveTarget) return;
    const url =
      moveTarget.kind === "folder"
        ? `/api/staff/files/folders/${moveTarget.id}`
        : `/api/staff/files/${moveTarget.id}`;
    const result = await fetchJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [moveTarget.kind === "folder" ? "parentId" : "folderId"]: moveFolderId === "root" ? null : moveFolderId }),
    });
    if (result.ok) {
      toast.success("انتقال انجام شد.");
      setMoveTarget(null);
      void load();
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const url =
      deleteTarget.kind === "folder"
        ? `/api/staff/files/folders/${deleteTarget.id}`
        : `/api/staff/files/${deleteTarget.id}`;
    const result = await fetchJson(url, { method: "DELETE" });
    if (result.ok) {
      toast.success("حذف انجام شد.");
      setDeleteTarget(null);
      void load();
    } else {
      toast.error(result.error);
      setDeleteTarget(null);
    }
  }

  function downloadFile(file: SharedFileView) {
    // Authorized backend download endpoint only — trigger via a temporary
    // anchor (assignment to window.location is blocked by lint rules).
    const a = document.createElement("a");
    a.href = `/api/staff/files/${file.id}/download`;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleReplace(file: File) {
    if (!replaceTarget) return;
    const form = new FormData();
    form.set("file", file);
    const result = await fetchJson<{ file: SharedFileView }>(`/api/staff/files/${replaceTarget.id}/replace`, {
      method: "PUT",
      body: form,
    });
    if (result.ok) {
      toast.success(`نسخه ${faNum(result.data.file.version)} جایگزین شد.`);
      setReplaceTarget(null);
      void load();
    } else {
      toast.error(result.error);
    }
  }

  async function openSettings() {
    setSettingsOpen(true);
    const result = await fetchJson<StorageSettingsView>("/api/staff/files/settings");
    if (result.ok) setSettingsView(result.data);
    else toast.error(result.error);
  }

  async function openUsage() {
    setUsageOpen(true);
    const params = new URLSearchParams({ departmentId });
    const result = await fetchJson<UsageReport>(`/api/staff/files/usage?${params.toString()}`);
    if (result.ok) setUsageReport(result.data);
    else toast.error(result.error);
  }

  async function saveSettings() {
    if (!settingsView) return;
    setSavingSettings(true);
    const result = await fetchJson<{ global: StorageSettingsView["global"]; av: StorageSettingsView["av"] }>("/api/staff/files/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalCapacityBytes: settingsView.global.totalCapacityBytes,
        defaultDepartmentQuotaBytes: settingsView.global.defaultDepartmentQuotaBytes,
        defaultOperatorQuotaBytes: settingsView.global.defaultOperatorQuotaBytes,
        maxUploadBytes: settingsView.global.maxUploadBytes,
        allowedExtensions: settingsView.global.allowedExtensions,
        av: {
          provider: settingsView.av.provider,
          host: settingsView.av.host,
          port: settingsView.av.port,
          timeoutMs: settingsView.av.timeoutMs,
        },
      }),
    });
    setSavingSettings(false);
    if (result.ok) {
      toast.success("تنظیمات ذخیره شد.");
      setSettingsView(result.data);
      void load();
    } else {
      toast.error(result.error);
    }
  }

  // -------------------------------------------------------------- render ---

  const usage = listing?.usage;
  const deptPercent = usage && usage.departmentQuotaBytes > 0
    ? Math.min(100, Math.round((usage.departmentUsedBytes / usage.departmentQuotaBytes) * 100))
    : 0;

  const moveTargets = useMemo(() => {
    if (!listing) return [];
    return listing.folders.filter((f) => f.id !== moveTarget?.id);
  }, [listing, moveTarget]);

  return (
    <div className="space-y-4">
      {/* Department selector + usage + actions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64">
              <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); setFolderId(null); }}>
                <SelectTrigger aria-label="انتخاب دپارتمان">
                  <SelectValue placeholder="انتخاب دپارتمان" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              به‌روزرسانی
            </Button>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {canViewUsage ? (
                <Button variant="outline" size="sm" onClick={() => void openUsage()}>
                  <HardDrive className="h-4 w-4" aria-hidden="true" />
                  گزارش مصرف
                </Button>
              ) : null}
              {canManageSettings ? (
                <Button variant="outline" size="sm" onClick={() => void openSettings()}>
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                  تنظیمات ذخیره‌سازی
                </Button>
              ) : null}
            </div>
          </div>
          <CardDescription className="text-xs">
            {departmentName}
            {listing ? ` — ${faNum(listing.folders.length)} پوشه، ${faNum(listing.files.length)} فایل در این مسیر` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {usage ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>مصرف دپارتمان از سهمیه</span>
                <span dir="ltr">
                  {faBytes(usage.departmentUsedBytes)} / {faBytes(usage.departmentQuotaBytes)}
                </span>
              </div>
              <Progress value={deptPercent} aria-label={`مصرف ${faNum(deptPercent)} درصد`} />
              <p className="text-[11px] text-muted-foreground">
                سهمیه شما: <span dir="ltr">{faBytes(usage.operatorUsedBytes)} / {faBytes(usage.operatorQuotaBytes)}</span>
                {" — "}
                کل سامانه: <span dir="ltr">{faBytes(usage.totalUsedBytes)} / {faBytes(usage.totalCapacityBytes)}</span>
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {listing?.avProvider === "none" ? (
              <Badge variant="outline" className="gap-1 whitespace-normal shrink text-left leading-4 text-amber-700 border-amber-300 bg-amber-50">
                <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                اسکن آنتی‌ویروس فعال نیست — وضعیت هر فایل صادقانه مشخص می‌شود
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300 bg-emerald-50">
                اسکن آنتی‌ویروس فعال (ClamAV)
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" aria-hidden="true" />
              نوع فایل از محتوا (magic bytes) تأیید می‌شود؛ پسوند اعلامی مشتری هرگز ملاک نیست.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar: breadcrumb + new folder + upload */}
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="مسیر پوشه‌ها" className="flex items-center gap-1 text-sm flex-wrap">
          <Button
            variant={folderId === null ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1"
            onClick={() => setFolderId(null)}
          >
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
            ریشه
          </Button>
          {(listing?.breadcrumb ?? [])
            .filter((b) => b.id !== null)
            .map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <Button variant={folderId === b.id ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setFolderId(b.id)}>
                  {b.name}
                </Button>
              </span>
            ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          {canCreateFolder ? (
            <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              پوشه جدید
            </Button>
          ) : null}
          {canUpload ? (
            <Button size="sm" onClick={() => { setUploadFiles([]); setUploadOpen(true); }}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              بارگذاری فایل
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      {/* Listing */}
      {loading && !listing ? (
        <div className="grid gap-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <ScrollArea className="max-h-[520px]">
            <ul className="divide-y">
              {(listing?.folders ?? []).map((folder) => (
                <li key={`f-${folder.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-secondary shrink-0">
                    <Folder className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                  </span>
                  <button
                    className="min-w-0 flex-1 text-start"
                    onClick={() => setFolderId(folder.id)}
                    aria-label={`ورود به پوشه ${folder.name}`}
                  >
                    <p className="text-sm font-medium truncate">{folder.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {faNum(folder.childrenCount)} زیرپوشه، {faNum(folder.fileCount)} فایل
                    </p>
                  </button>
                  {canManageFolderEntries ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`عملیات پوشه ${folder.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {canRename ? (
                          <DropdownMenuItem onClick={() => { setRenameTarget({ kind: "folder", id: folder.id, name: folder.name }); setRenameValue(folder.name); }}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                            تغییر نام
                          </DropdownMenuItem>
                        ) : null}
                        {canMove ? (
                          <DropdownMenuItem onClick={() => { setMoveTarget({ kind: "folder", id: folder.id, name: folder.name }); setMoveFolderId("root"); }}>
                            <FolderInput className="h-4 w-4" aria-hidden="true" />
                            انتقال پوشه
                          </DropdownMenuItem>
                        ) : null}
                        {canDelete ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              حذف پوشه
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              ))}
              {(listing?.files ?? []).map((file) => (
                <li key={`d-${file.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-lg shrink-0" aria-hidden="true">
                    {fileIcon(file.mimeType)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium truncate">
                      <span className="truncate">{file.name}</span>
                      {file.scanStatus === "SKIPPED" ? (
                        <Badge variant="outline" className="text-[10px] shrink-0 text-amber-700 border-amber-300">بدون اسکن</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] shrink-0 text-emerald-700 border-emerald-300">اسکن‌شده</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {faBytes(file.sizeBytes)} — نسخه {faNum(file.version)} — {file.uploaderName ?? "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {canDownload ? (
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`دانلود ${file.name}`} onClick={() => downloadFile(file)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {canManageFileEntries ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`عملیات فایل ${file.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {canReplace ? (
                            <DropdownMenuItem onClick={() => { setReplaceTarget(file); }}>
                              <Replace className="h-4 w-4" aria-hidden="true" />
                              جایگزینی نسخه
                            </DropdownMenuItem>
                          ) : null}
                          {canRename ? (
                            <DropdownMenuItem onClick={() => { setRenameTarget({ kind: "file", id: file.id, name: file.name }); setRenameValue(file.name); }}>
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                              تغییر نام
                            </DropdownMenuItem>
                          ) : null}
                          {canMove ? (
                            <DropdownMenuItem onClick={() => { setMoveTarget({ kind: "file", id: file.id, name: file.name }); setMoveFolderId("root"); }}>
                              <FolderInput className="h-4 w-4" aria-hidden="true" />
                              انتقال فایل
                            </DropdownMenuItem>
                          ) : null}
                          {canDelete ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget({ kind: "file", id: file.id, name: file.name })}>
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                حذف فایل
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </li>
              ))}
              {listing && listing.folders.length === 0 && listing.files.length === 0 ? (
                <li className="p-8 text-center text-sm text-muted-foreground">
                  این پوشه خالی است.
                  {canUpload ? " فایل جدیدی بارگذاری کنید." : ""}
                </li>
              ) : null}
              {!listing && !loading ? (
                <li className="p-8 text-center text-sm text-muted-foreground">فهرست در دسترس نیست.</li>
              ) : null}
            </ul>
          </ScrollArea>
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>بارگذاری فایل</DialogTitle>
            <DialogDescription>
              حداکثر ۱۰ فایل در هر بار ثبت — همه‌ی فایل‌ها پیش از ذخیره‌سازی اعتبارسنجی می‌شوند؛ در صورت خطا هیچ فایلی ذخیره نمی‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="file"
              multiple
              onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
              aria-label="انتخاب فایل‌ها"
            />
            {uploadFiles.length > 0 ? (
              <ul className="rounded-lg border p-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                {uploadFiles.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <span dir="ltr" className="text-muted-foreground shrink-0">{faBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              پسوندهای مجاز: pdf، png، jpg، webp، zip، docx، txt، csv — سهمیه دپارتمان و اپراتور در لحظه بررسی می‌شود.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>انصراف</Button>
            <Button onClick={() => void handleUpload()} disabled={uploading || uploadFiles.length === 0}>
              {uploading ? "در حال بارگذاری…" : "بارگذاری"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>پوشه جدید</DialogTitle>
            <DialogDescription>پوشه‌ای تودرتو در همین مسیر ایجاد می‌شود.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-folder-name">نام پوشه</Label>
            <Input
              id="new-folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              maxLength={80}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateFolder(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>انصراف</Button>
            <Button onClick={() => void handleCreateFolder()} disabled={!newFolderName.trim()}>ایجاد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>تغییر نام {renameTarget?.kind === "folder" ? "پوشه" : "فایل"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-value">نام جدید</Label>
            <Input
              id="rename-value"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleRename(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>انصراف</Button>
            <Button onClick={() => void handleRename()} disabled={!renameValue.trim()}>ذخیره</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move dialog */}
      <Dialog open={!!moveTarget} onOpenChange={(open) => { if (!open) setMoveTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>انتقال {moveTarget?.kind === "folder" ? "پوشه" : "فایل"}</DialogTitle>
            <DialogDescription>
              مقصد باید در همان دپارتمان باشد؛ انتقال بین‌دپارتمانی سمت سرور مسدود است.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="move-target">پوشه مقصد</Label>
            <Select value={moveFolderId} onValueChange={setMoveFolderId}>
              <SelectTrigger id="move-target" aria-label="پوشه مقصد">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">ریشه دپارتمان</SelectItem>
                {moveTargets.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)}>انصراف</Button>
            <Button onClick={() => void handleMove()}>انتقال</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {deleteTarget?.kind === "folder" ? "پوشه" : "فایل"} «{deleteTarget?.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "folder"
                ? "همه زیرپوشه‌ها و فایل‌های داخل این پوشه نیز حذف می‌شوند و قابل بازگشت نیستند."
                : "این فایل برای همیشه حذف می‌شود و قابل بازگشت نیست."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void handleDelete()}>
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace dialog */}
      <Dialog open={!!replaceTarget} onOpenChange={(open) => { if (!open) setReplaceTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>جایگزینی نسخه «{replaceTarget?.name}»</DialogTitle>
            <DialogDescription>
              نسخه فعلی: {replaceTarget ? faNum(replaceTarget.version) : ""} — پس از جایگزینی شماره نسخه افزایش می‌یابد و نسخه قبلی حذف می‌شود.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleReplace(f);
            }}
            aria-label="انتخاب فایل جایگزین"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplaceTarget(null)}>انصراف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usage dialog */}
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>گزارش مصرف فضای ذخیره‌سازی</DialogTitle>
            <DialogDescription>مصرف کل، دپارتمان‌ها و اپراتورها — بر اساس داده لحظه‌ای.</DialogDescription>
          </DialogHeader>
          {usageReport ? (
            <div className="max-h-[420px] overflow-y-auto pl-1">
              <StorageUsageView report={usageReport} />
            </div>
          ) : (
            <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          )}
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تنظیمات ذخیره‌سازی</DialogTitle>
            <DialogDescription>
              ظرفیت‌ها و سهمیه‌ها بر حسب بایت — اعتبارسنجی سهمیه‌ها سمت سرور انجام می‌شود.
            </DialogDescription>
          </DialogHeader>
          {settingsView ? (
            <div className="max-h-[420px] overflow-y-auto pl-1">
              <StorageSettingsFields view={settingsView} onChange={setSettingsView} />
            </div>
          ) : (
            <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>انصراف</Button>
            <Button onClick={() => void saveSettings()} disabled={savingSettings || !settingsView}>
              {savingSettings ? "در حال ذخیره…" : "ذخیره تنظیمات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
