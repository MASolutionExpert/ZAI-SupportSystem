"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Eye,
  FileText,
  FolderTree,
  Loader2,
  Lock,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson, type ApiResult } from "@/lib/client/api";
import { faBytes, faDateTimeFormat, faNum } from "@/lib/format";
import {
  KB_COLLECTION_ACCESS,
  KB_COLLECTION_ACCESS_LABELS,
  KB_DOCUMENT_STATUSES,
  KB_DOCUMENT_STATUS_LABELS,
} from "@/lib/kb/types";

// ------------------------------------------------------------------- types --

export type KbPermissions = {
  canView: boolean;
  canManageCollections: boolean;
  canAssignDepartments: boolean;
  canUpload: boolean;
  canDeleteDoc: boolean;
  canReprocess: boolean;
  canQaCreate: boolean;
  canQaEdit: boolean;
  canQaPublish: boolean;
};

type KbDepartmentRef = { id: string; name: string };

type KbDocument = {
  id: string;
  title: string;
  collectionId: string;
  collectionName: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  statusError: string | null;
  chunkCount: number | null;
  extractedChars: number | null;
  createdAt: string;
  updatedAt: string;
  uploaderName: string;
};

type KbDocumentVersion = {
  id: string;
  versionNo: number;
  sizeBytes: number;
  mimeType: string;
  checksum: string;
  uploadedAt: string;
  uploaderName: string;
};

type KbDocumentDetail = KbDocument & {
  versions: KbDocumentVersion[];
  textPreview: string | null;
  storagePresent: boolean;
};

type KbCollection = {
  id: string;
  name: string;
  description: string | null;
  access: string;
  isActive: boolean;
  documentCount: number;
  departments: KbDepartmentRef[];
  createdAt: string;
  updatedAt: string;
};

type KbQaEntry = {
  id: string;
  question: string;
  officialAnswer: string;
  category: string | null;
  keywords: string[];
  status: string;
  alternates: string[];
  departments: KbDepartmentRef[];
  createdAt: string;
  updatedAt: string;
  createdByName: string;
};

// ----------------------------------------------------------------- helpers --

/** Multipart variant of apiFetch — never sets Content-Type manually. */
async function apiForm<T>(url: string, form: FormData): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    const body = (await res.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: string }
      | null;
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        error:
          body && !body.ok
            ? body.error
            : "خطای غیرمنتظره در ارتباط با سرور.",
      };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, error: "ارتباط با سرور برقرار نشد." };
  }
}

function DocumentStatusBadge({ status }: { status: string }) {
  if (status === "INDEXED") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        فهرست‌شده
      </Badge>
    );
  }
  if (status === "FAILED") return <Badge variant="destructive">ناموفق</Badge>;
  if (status === "PROCESSING") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
        در حال پردازش
      </Badge>
    );
  }
  if (status === "UPLOADED") return <Badge variant="secondary">بارگذاری‌شده</Badge>;
  if (status === "DISABLED") return <Badge variant="outline">غیرفعال</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function CollectionAccessBadge({ access }: { access: string }) {
  if (access === "GLOBAL") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        سازمانی (همه دپارتمان‌ها)
      </Badge>
    );
  }
  if (access === "DEPARTMENT") return <Badge variant="secondary">دپارتمانی</Badge>;
  if (access === "RESTRICTED") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
        محدود (مدیریتی)
      </Badge>
    );
  }
  return <Badge variant="outline">{access}</Badge>;
}

function QaStatusBadge({ status }: { status: string }) {
  if (status === "PUBLISHED") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        منتشرشده
      </Badge>
    );
  }
  if (status === "DRAFT") return <Badge variant="secondary">پیش‌نویس</Badge>;
  if (status === "DISABLED") return <Badge variant="outline">غیرفعال</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function DepartmentChips({ departments }: { departments: KbDepartmentRef[] }) {
  if (departments.length === 0) {
    return <span className="text-xs text-muted-foreground">بدون دپارتمان</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {departments.map((d) => (
        <Badge key={d.id} variant="outline" className="text-[11px] font-normal">
          {d.name}
        </Badge>
      ))}
    </div>
  );
}

function LockedState({ note }: { note: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">دسترسی مشاهده وجود ندارد</p>
        <p className="max-w-md text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <span className="text-muted-foreground">{icon}</span>
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

/** Shared checkbox-picker dialog for assigning departments to a collection or Q&A entry. */
function DepartmentsAssignDialog({
  target,
  departments,
  onOpenChange,
  onSaved,
}: {
  target: { kind: "collection" | "qa"; id: string; name: string; current: string[] } | null;
  departments: KbDepartmentRef[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Keyed by the target so the draft selection is re-initialized from props
  // each time a new assignment dialog opens (no state-reset effect needed).
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      {target ? (
        <DepartmentsAssignBody
          key={`${target.kind}:${target.id}`}
          target={target}
          departments={departments}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function DepartmentsAssignBody({
  target,
  departments,
  onOpenChange,
  onSaved,
}: {
  target: { kind: "collection" | "qa"; id: string; name: string; current: string[] };
  departments: KbDepartmentRef[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(target.current));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (selected.size === 0) {
      toast({ title: "حداقل یک دپارتمان انتخاب کنید.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const url =
      target.kind === "collection"
        ? `/api/admin/kb/collections/${target.id}/departments`
        : `/api/admin/kb/qa/${target.id}/departments`;
    const res = await apiFetch<{ assigned: number }>(
      url,
      apiJson("PUT", { departmentIds: [...selected] })
    );
    setSaving(false);
    if (!res.ok) {
      toast({ title: "انتساب دپارتمان‌ها ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "دپارتمان‌ها منتسب شدند" });
    onOpenChange(false);
    onSaved();
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>انتساب دپارتمان‌ها</DialogTitle>
        <DialogDescription>
          دسترسی «{target.name}» را برای دپارتمان‌های انتخاب‌شده تنظیم کنید؛ فهرست فعلی به‌طور کامل جایگزین می‌شود.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-72 overflow-y-auto scroll-slim rounded-lg border p-3">
        {departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">دپارتمان فعالی ثبت نشده است.</p>
        ) : (
          <ul className="space-y-2.5">
            {departments.map((d) => (
              <li key={d.id} className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  id={`assign-${target.kind}-${d.id}`}
                  checked={selected.has(d.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(d.id);
                    else next.delete(d.id);
                    setSelected(next);
                  }}
                />
                <Label htmlFor={`assign-${target.kind}-${d.id}`} className="cursor-pointer font-normal">
                  {d.name}
                </Label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          انصراف
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          ذخیره
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ------------------------------------------------------------- main manager --

export function KbManager({
  permissions,
  departments,
}: {
  permissions: KbPermissions;
  departments: KbDepartmentRef[];
}) {
  return (
    <Tabs defaultValue="documents" className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="documents" className="gap-1.5">
          <FileText className="h-4 w-4" aria-hidden="true" />
          اسناد سازمانی
        </TabsTrigger>
        <TabsTrigger value="collections" className="gap-1.5">
          <FolderTree className="h-4 w-4" aria-hidden="true" />
          مجموعه‌های دانش
        </TabsTrigger>
        <TabsTrigger value="qa" className="gap-1.5">
          <MessagesSquare className="h-4 w-4" aria-hidden="true" />
          پرسش و پاسخ رسمی
        </TabsTrigger>
      </TabsList>

      <TabsContent value="documents">
        <DocumentsTab permissions={permissions} />
      </TabsContent>
      <TabsContent value="collections">
        <CollectionsTab permissions={permissions} departments={departments} />
      </TabsContent>
      <TabsContent value="qa">
        <QaTab permissions={permissions} departments={departments} />
      </TabsContent>
    </Tabs>
  );
}

// ------------------------------------------------------------ documents tab --

function DocumentsTab({ permissions }: { permissions: KbPermissions }) {
  const { toast } = useToast();
  const { canView, canManageCollections, canUpload, canDeleteDoc, canReprocess } = permissions;

  const [documents, setDocuments] = useState<KbDocument[] | null>(null);
  const [collections, setCollections] = useState<KbCollection[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // upload dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCollectionId, setUploadCollectionId] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadFileRef = useRef<HTMLInputElement | null>(null);

  // details dialog
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KbDocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // metadata edit dialog
  const [metaTarget, setMetaTarget] = useState<KbDocument | null>(null);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaCollectionId, setMetaCollectionId] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  // replace dialog
  const [replaceTarget, setReplaceTarget] = useState<KbDocument | null>(null);
  const [replacing, setReplacing] = useState(false);
  const replaceFileRef = useRef<HTMLInputElement | null>(null);

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<KbDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchDocuments = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    const res = await apiFetch<{ documents: KbDocument[] }>(
      `/api/admin/kb/documents?${params.toString()}`
    );
    if (res.ok) {
      setDocuments(res.data.documents);
    } else {
      setDocuments([]);
      toast({ title: "خطا در دریافت اسناد", description: res.error, variant: "destructive" });
    }
  }, [statusFilter, debouncedSearch, toast]);

  // Search debounce (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      const res = await apiFetch<{ documents: KbDocument[] }>(
        `/api/admin/kb/documents?${params.toString()}`
      );
      if (cancelled) return;
      if (res.ok) setDocuments(res.data.documents);
      else {
        setDocuments([]);
        toast({ title: "خطا در دریافت اسناد", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, statusFilter, debouncedSearch, toast]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ collections: KbCollection[] }>("/api/admin/kb/collections");
      if (cancelled) return;
      if (res.ok) setCollections(res.data.collections);
      else {
        setCollections([]);
        toast({ title: "خطا در دریافت مجموعه‌ها", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, toast]);

  function openUpload() {
    setUploadTitle("");
    setUploadCollectionId(collections[0]?.id ?? "");
    if (uploadFileRef.current) uploadFileRef.current.value = "";
    setUploadOpen(true);
  }

  function refreshDocuments() {
    setRefreshing(true);
    void fetchDocuments().finally(() => setRefreshing(false));
  }

  async function handleUpload() {
    const file = uploadFileRef.current?.files?.[0];
    if (!file) {
      toast({ title: "انتخاب فایل سند الزامی است.", variant: "destructive" });
      return;
    }
    if (!uploadCollectionId) {
      toast({ title: "مجموعه دانش را انتخاب کنید.", variant: "destructive" });
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("collectionId", uploadCollectionId);
    if (uploadTitle.trim()) form.set("title", uploadTitle.trim());

    setUploading(true);
    const res = await apiForm<{ documentId: string; status: string; error?: string }>(
      "/api/admin/kb/documents",
      form
    );
    setUploading(false);
    if (!res.ok) {
      toast({ title: "بارگذاری سند ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    if (res.data.status === "INDEXED") {
      toast({ title: "سند فهرست‌شده شد", description: "قطعه‌های سند برای جست‌وجوی دستیار آماده است." });
    } else if (res.data.status === "FAILED") {
      toast({
        title: "سند بارگذاری شد اما فهرست‌سازی ناموفق بود",
        description: res.data.error ?? "خطای نامشخص در پردازش سند.",
        variant: "destructive",
      });
    } else if (res.data.status === "PROCESSING") {
      toast({ title: "سند در صف پردازش قرار گرفت" });
    } else {
      toast({ title: "سند بارگذاری شد" });
    }
    setUploadOpen(false);
    void fetchDocuments();
  }

  async function openDetail(id: string) {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    const res = await apiFetch<{ document: KbDocumentDetail }>(`/api/admin/kb/documents/${id}`);
    setDetailLoading(false);
    if (res.ok) {
      setDetail(res.data.document);
    } else {
      toast({ title: "دریافت جزئیات سند ناموفق بود", description: res.error, variant: "destructive" });
      setDetailId(null);
    }
  }

  function openMetaEdit(doc: KbDocument) {
    setMetaTarget(doc);
    setMetaTitle(doc.title);
    setMetaCollectionId(doc.collectionId);
  }

  async function handleSaveMeta() {
    if (!metaTarget) return;
    if (!metaTitle.trim()) {
      toast({ title: "عنوان سند الزامی است.", variant: "destructive" });
      return;
    }
    setSavingMeta(true);
    const payload: { title: string; collectionId?: string } = { title: metaTitle.trim() };
    if (canManageCollections && metaCollectionId) {
      payload.collectionId = metaCollectionId;
    }
    const res = await apiFetch<{ document: KbDocument }>(
      `/api/admin/kb/documents/${metaTarget.id}`,
      apiJson("PATCH", payload)
    );
    setSavingMeta(false);
    if (!res.ok) {
      toast({ title: "ذخیره ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "اطلاعات سند به‌روزرسانی شد" });
    setMetaTarget(null);
    void fetchDocuments();
  }

  async function toggleActive(doc: KbDocument) {
    // DISABLED is the persisted "inactive" representation of a document.
    const nextActive = doc.status === "DISABLED";
    const res = await apiFetch<{ document: KbDocument }>(
      `/api/admin/kb/documents/${doc.id}`,
      apiJson("PATCH", { isActive: nextActive })
    );
    if (!res.ok) {
      toast({ title: "تغییر وضعیت سند ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: nextActive ? "سند فعال شد" : "سند غیرفعال شد" });
    void fetchDocuments();
  }

  async function handleReprocess(doc: KbDocument) {
    const res = await apiFetch<{ status: string; error?: string }>(
      `/api/admin/kb/documents/${doc.id}/reprocess`,
      apiJson("POST", {})
    );
    if (!res.ok) {
      toast({ title: "پردازش مجدد ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    if (res.data.status === "INDEXED") {
      toast({ title: "سند دوباره فهرست‌سازی شد" });
    } else if (res.data.status === "FAILED") {
      toast({
        title: "پردازش مجدد ناموفق بود",
        description: res.data.error ?? "خطای نامشخص در پردازش سند.",
        variant: "destructive",
      });
    } else {
      toast({ title: "سند در صف پردازش قرار گرفت" });
    }
    void fetchDocuments();
  }

  function openReplace(doc: KbDocument) {
    if (replaceFileRef.current) replaceFileRef.current.value = "";
    setReplaceTarget(doc);
  }

  async function handleReplace() {
    if (!replaceTarget) return;
    const file = replaceFileRef.current?.files?.[0];
    if (!file) {
      toast({ title: "انتخاب فایل جدید الزامی است.", variant: "destructive" });
      return;
    }
    const form = new FormData();
    form.set("file", file);
    setReplacing(true);
    const res = await apiForm<{ status: string; error?: string }>(
      `/api/admin/kb/documents/${replaceTarget.id}/replace`,
      form
    );
    setReplacing(false);
    if (!res.ok) {
      toast({ title: "جایگزینی فایل ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    if (res.data.status === "FAILED") {
      toast({
        title: "نسخه جدید ذخیره شد اما فهرست‌سازی ناموفق بود",
        description: res.data.error ?? "خطای نامشخص در پردازش سند.",
        variant: "destructive",
      });
    } else {
      toast({ title: "نسخه جدید سند جایگزین و فهرست‌سازی شد" });
    }
    setReplaceTarget(null);
    void fetchDocuments();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await apiFetch<{ deleted: boolean }>(
      `/api/admin/kb/documents/${deleteTarget.id}`,
      { method: "DELETE" }
    );
    setDeleting(false);
    if (!res.ok) {
      toast({ title: "حذف سند ناموفق بود", description: res.error, variant: "destructive" });
      setDeleteTarget(null);
      return;
    }
    toast({ title: "سند و داده‌های فهرست‌شده آن حذف شد" });
    setDeleteTarget(null);
    void fetchDocuments();
  }

  if (!canView) {
    return <LockedState note="مشاهده اسناد نیاز به مجوز kb.view دارد." />;
  }

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="فیلتر وضعیت سند">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">همه وضعیت‌ها</SelectItem>
              {KB_DOCUMENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {KB_DOCUMENT_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-52">
            <Search
              className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جست‌وجو در عنوان اسناد…"
              className="pe-9"
              aria-label="جست‌وجوی سند"
            />
          </div>
          <Button
            variant="outline"
            onClick={refreshDocuments}
            disabled={refreshing}
            aria-label="بازخوانی فهرست اسناد"
          >
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
            بازخوانی
          </Button>
        </div>
        {canUpload ? (
          <Button onClick={openUpload}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            بارگذاری سند
          </Button>
        ) : null}
      </div>

      {/* table */}
      {documents === null ? (
        <ListSkeleton />
      ) : documents.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" aria-hidden="true" />}
          title="سندی یافت نشد"
          description={
            debouncedSearch || statusFilter !== "ALL"
              ? "با فیلترهای فعلی سندی یافت نشد؛ فیلترها را تغییر دهید."
              : "اولین سند سازمانی را بارگذاری کنید تا دستیار هوشمند بتواند از آن پاسخ دهد."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>عنوان</TableHead>
                <TableHead>مجموعه</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>حجم</TableHead>
                <TableHead>قطعه‌ها</TableHead>
                <TableHead>آخرین تغییر</TableHead>
                <TableHead className="text-start">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="max-w-64">
                    <p className="truncate font-medium">{doc.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
                      {doc.originalFilename}
                    </p>
                    {doc.status === "FAILED" && doc.statusError ? (
                      <p className="mt-1 text-xs text-destructive">{doc.statusError}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">{doc.collectionName}</TableCell>
                  <TableCell>
                    <DocumentStatusBadge status={doc.status} />
                  </TableCell>
                  <TableCell className="text-sm">{faBytes(doc.sizeBytes)}</TableCell>
                  <TableCell className="text-sm">
                    {doc.chunkCount === null ? "—" : faNum(doc.chunkCount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {faDateTimeFormat(doc.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`عملیات سند ${doc.title}`}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canView ? (
                          <DropdownMenuItem onClick={() => void openDetail(doc.id)}>
                            <Eye className="h-4 w-4" aria-hidden="true" />
                            مشاهده جزئیات
                          </DropdownMenuItem>
                        ) : null}
                        {canReprocess ? (
                          <DropdownMenuItem onClick={() => void handleReprocess(doc)}>
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            پردازش مجدد
                          </DropdownMenuItem>
                        ) : null}
                        {canUpload ? (
                          <DropdownMenuItem onClick={() => openReplace(doc)}>
                            <Upload className="h-4 w-4" aria-hidden="true" />
                            جایگزینی فایل
                          </DropdownMenuItem>
                        ) : null}
                        {canUpload ? (
                          <DropdownMenuItem onClick={() => openMetaEdit(doc)}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                            ویرایش عنوان/مجموعه
                          </DropdownMenuItem>
                        ) : null}
                        {canUpload ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => void toggleActive(doc)}>
                              <X className="h-4 w-4" aria-hidden="true" />
                              {doc.status === "DISABLED" ? "فعال‌سازی سند" : "غیرفعال‌سازی سند"}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        {canDeleteDoc ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget(doc)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              حذف سند
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>بارگذاری سند سازمانی</DialogTitle>
            <DialogDescription>
              فایل پس از بارگذاری به‌صورت خودکار استخراج، قطعه‌بندی و فهرست‌سازی می‌شود. فرمت‌های مجاز: PDF،
              Word (docx)، TXT و Markdown — حداکثر ۱۵ مگابایت.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="kb-upload-title">عنوان سند (اختیاری)</Label>
              <Input
                id="kb-upload-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="بدون عنوان از نام فایل"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-upload-collection">مجموعه دانش</Label>
              <Select value={uploadCollectionId} onValueChange={setUploadCollectionId}>
                <SelectTrigger id="kb-upload-collection" className="w-full" aria-label="انتخاب مجموعه دانش">
                  <SelectValue placeholder="مجموعه را انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-upload-file">فایل سند</Label>
              <Input
                id="kb-upload-file"
                type="file"
                accept=".pdf,.docx,.txt,.md"
                ref={uploadFileRef}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>
              انصراف
            </Button>
            <Button onClick={() => void handleUpload()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              بارگذاری و فهرست‌سازی
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* details dialog */}
      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>جزئیات سند</DialogTitle>
            <DialogDescription>
              {detail ? detail.title : "در حال دریافت اطلاعات سند…"}
            </DialogDescription>
          </DialogHeader>
          {detailLoading || !detail ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-4 py-1">
              {!detail.storagePresent ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  فایل در دیسک یافت نشد — پردازش مجدد تا بازبارگذاری نسخه انجام نمی‌شود.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <DocumentStatusBadge status={detail.status} />
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">مجموعه دانش</dt>
                  <dd>{detail.collectionName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">نام فایل اصلی</dt>
                  <dd dir="auto" className="truncate">{detail.originalFilename}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">نوع فایل</dt>
                  <dd dir="ltr" className="text-start">{detail.mimeType}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">حجم</dt>
                  <dd>{faBytes(detail.sizeBytes)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">قطعه‌های فهرست‌شده</dt>
                  <dd>{detail.chunkCount === null ? "—" : faNum(detail.chunkCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">کاراکترهای استخراج‌شده</dt>
                  <dd>{detail.extractedChars === null ? "—" : faNum(detail.extractedChars)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">بارگذارنده</dt>
                  <dd>{detail.uploaderName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">ایجاد / آخرین تغییر</dt>
                  <dd className="text-xs">
                    {faDateTimeFormat(detail.createdAt)} — {faDateTimeFormat(detail.updatedAt)}
                  </dd>
                </div>
              </dl>
              {detail.statusError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {detail.statusError}
                </div>
              ) : null}

              <div>
                <h4 className="mb-2 text-sm font-semibold">نسخه‌های سند</h4>
                {detail.versions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">نسخه‌ای ثبت نشده است.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>نسخه</TableHead>
                          <TableHead>حجم</TableHead>
                          <TableHead>نوع</TableHead>
                          <TableHead>بارگذاری</TableHead>
                          <TableHead>بارگذارنده</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.versions.map((version) => (
                          <TableRow key={version.id}>
                            <TableCell className="text-sm">{faNum(version.versionNo)}</TableCell>
                            <TableCell className="text-sm">{faBytes(version.sizeBytes)}</TableCell>
                            <TableCell dir="ltr" className="text-start text-xs text-muted-foreground">
                              {version.mimeType}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {faDateTimeFormat(version.uploadedAt)}
                            </TableCell>
                            <TableCell className="text-sm">{version.uploaderName}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold">پیش‌نمایش متنی</h4>
                {detail.textPreview ? (
                  <div className="max-h-64 overflow-y-auto scroll-slim whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6" dir="auto">
                    {detail.textPreview}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">پیش‌نمایش متنی موجود نیست.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* metadata edit dialog */}
      <Dialog open={metaTarget !== null} onOpenChange={(open) => !open && setMetaTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ویرایش عنوان/مجموعه سند</DialogTitle>
            <DialogDescription>
              این تغییرات فقط اطلاعات سند را به‌روزرسانی می‌کند؛ وضعیت فهرست‌سازی بدون تغییر می‌ماند.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="kb-meta-title">عنوان سند</Label>
              <Input
                id="kb-meta-title"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                maxLength={200}
              />
            </div>
            {canManageCollections ? (
              <div className="space-y-2">
                <Label htmlFor="kb-meta-collection">مجموعه دانش</Label>
                <Select value={metaCollectionId} onValueChange={setMetaCollectionId}>
                  <SelectTrigger id="kb-meta-collection" className="w-full" aria-label="انتخاب مجموعه دانش">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  انتقال سند به مجموعه دیگر نیازمند مجوز مدیریت مجموعه‌هاست.
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetaTarget(null)} disabled={savingMeta}>
              انصراف
            </Button>
            <Button onClick={() => void handleSaveMeta()} disabled={savingMeta}>
              {savingMeta ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* replace dialog */}
      <Dialog open={replaceTarget !== null} onOpenChange={(open) => !open && setReplaceTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>جایگزینی فایل سند</DialogTitle>
            <DialogDescription>
              نسخه جدید جایگزین نسخه فعال می‌شود و سند دوباره فهرست‌سازی می‌گردد؛ نسخه قبلی در تاریخچه حفظ می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="kb-replace-file">فایل جدید</Label>
            <Input id="kb-replace-file" type="file" accept=".pdf,.docx,.txt,.md" ref={replaceFileRef} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplaceTarget(null)} disabled={replacing}>
              انصراف
            </Button>
            <Button onClick={() => void handleReplace()} disabled={replacing}>
              {replacing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              جایگزینی و فهرست‌سازی
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف سند</AlertDialogTitle>
            <AlertDialogDescription>
              سند «{deleteTarget?.title}» برای همیشه حذف می‌شود؛ نسخه‌های فایل از دیسک و همه قطعه‌های
              فهرست‌شده از پایگاه داده پاک می‌شوند و امکان بازگشت وجود ندارد. این عمل در گزارش حسابرسی ثبت می‌شود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------- collections tab --

function CollectionsTab({
  permissions,
  departments,
}: {
  permissions: KbPermissions;
  departments: KbDepartmentRef[];
}) {
  const { toast } = useToast();
  const { canView, canManageCollections, canAssignDepartments } = permissions;

  const [collections, setCollections] = useState<KbCollection[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // create / edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", access: "GLOBAL", departmentIds: [] as string[] });
  const [saving, setSaving] = useState(false);

  // department assignment
  const [assignTarget, setAssignTarget] = useState<{
    kind: "collection" | "qa";
    id: string;
    name: string;
    current: string[];
  } | null>(null);

  // delete
  const [deleteTarget, setDeleteTarget] = useState<KbCollection | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    const res = await apiFetch<{ collections: KbCollection[] }>("/api/admin/kb/collections");
    if (res.ok) {
      setCollections(res.data.collections);
    } else {
      setCollections([]);
      toast({ title: "خطا در دریافت مجموعه‌ها", description: res.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ collections: KbCollection[] }>("/api/admin/kb/collections");
      if (cancelled) return;
      if (res.ok) setCollections(res.data.collections);
      else {
        setCollections([]);
        toast({ title: "خطا در دریافت مجموعه‌ها", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, toast]);

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", description: "", access: "GLOBAL", departmentIds: [] });
    setDialogOpen(true);
  }

  function openEdit(collection: KbCollection) {
    setEditingId(collection.id);
    setForm({
      name: collection.name,
      description: collection.description ?? "",
      access: collection.access,
      departmentIds: collection.departments.map((d) => d.id),
    });
    setDialogOpen(true);
  }

  function toggleDepartment(id: string) {
    setForm((prev) => ({
      ...prev,
      departmentIds: prev.departmentIds.includes(id)
        ? prev.departmentIds.filter((d) => d !== id)
        : [...prev.departmentIds, id],
    }));
  }

  async function handleSave() {
    if (form.name.trim().length < 1) {
      toast({ title: "نام مجموعه الزامی است.", variant: "destructive" });
      return;
    }
    if (form.access === "DEPARTMENT" && form.departmentIds.length === 0) {
      toast({ title: "برای مجموعه دپارتمانی حداقل یک دپارتمان انتخاب کنید.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: {
      name: string;
      description?: string;
      access: string;
      departmentIds?: string[];
    } = {
      name: form.name.trim(),
      access: form.access,
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.access === "DEPARTMENT") payload.departmentIds = form.departmentIds;

    const res = editingId
      ? await apiFetch(`/api/admin/kb/collections/${editingId}`, apiJson("PATCH", payload))
      : await apiFetch("/api/admin/kb/collections", apiJson("POST", payload));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "ذخیره مجموعه ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "مجموعه ویرایش شد" : "مجموعه دانش ایجاد شد" });
    setDialogOpen(false);
    void reload();
  }

  async function toggleActive(collection: KbCollection) {
    setBusyId(collection.id);
    const res = await apiFetch(
      `/api/admin/kb/collections/${collection.id}`,
      apiJson("PATCH", { isActive: !collection.isActive })
    );
    setBusyId(null);
    if (!res.ok) {
      toast({ title: "تغییر وضعیت مجموعه ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    setCollections((prev) =>
      prev
        ? prev.map((row) => (row.id === collection.id ? { ...row, isActive: !collection.isActive } : row))
        : prev
    );
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await apiFetch<{ deleted: boolean }>(
      `/api/admin/kb/collections/${deleteTarget.id}`,
      { method: "DELETE" }
    );
    setDeleting(false);
    if (!res.ok) {
      // Server returns 409 with a Persian message when the collection has documents.
      toast({ title: "حذف مجموعه ناموفق بود", description: res.error, variant: "destructive" });
      setDeleteTarget(null);
      return;
    }
    toast({ title: "مجموعه دانش حذف شد" });
    setDeleteTarget(null);
    void reload();
  }

  const collectionForm = (
    <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{editingId ? "ویرایش مجموعه دانش" : "مجموعه جدید"}</DialogTitle>
        <DialogDescription>
          مجموعه‌ها کانتینر اسناد سازمانی هستند و سطح دسترسی آن‌ها هنگام جست‌وجوی دستیار اعمال می‌شود.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-1">
        <div className="space-y-2">
          <Label htmlFor="kb-collection-name">نام مجموعه</Label>
          <Input
            id="kb-collection-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="مثلاً آیین‌نامه‌های مالی"
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kb-collection-desc">توضیح (اختیاری)</Label>
          <Textarea
            id="kb-collection-desc"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="شرح محتوای این مجموعه"
            rows={2}
            maxLength={500}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kb-collection-access">سطح دسترسی</Label>
          <Select
            value={form.access}
            onValueChange={(v) => setForm({ ...form, access: v })}
          >
            <SelectTrigger id="kb-collection-access" className="w-full" aria-label="سطح دسترسی مجموعه">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KB_COLLECTION_ACCESS.map((access) => (
                <SelectItem key={access} value={access}>
                  {KB_COLLECTION_ACCESS_LABELS[access]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {form.access === "DEPARTMENT" ? (
          <div className="space-y-2 rounded-lg border p-3">
            <Label>دپارتمان‌های مجاز</Label>
            <div className="max-h-44 overflow-y-auto scroll-slim">
              <ul className="space-y-2.5">
                {departments.length === 0 ? (
                  <li className="text-xs text-muted-foreground">دپارتمان فعالی ثبت نشده است.</li>
                ) : (
                  departments.map((d) => (
                    <li key={d.id} className="flex items-center gap-2.5 text-sm">
                      <Checkbox
                        id={`kb-collection-dept-${editingId ?? "new"}-${d.id}`}
                        checked={form.departmentIds.includes(d.id)}
                        onCheckedChange={() => toggleDepartment(d.id)}
                      />
                      <Label htmlFor={`kb-collection-dept-${editingId ?? "new"}-${d.id}`} className="cursor-pointer font-normal">
                        {d.name}
                      </Label>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              برای سطح «دپارتمانی» حداقل یک دپارتمان لازم است؛ انتساب‌ها بعداً نیز قابل تغییرند.
            </p>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
          انصراف
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          ذخیره
        </Button>
      </DialogFooter>
    </DialogContent>
  );

  if (!canView) {
    return (
      <div className="space-y-4">
        <LockedState note="مشاهده مجموعه‌ها نیاز به مجوز kb.view دارد." />
        {canManageCollections ? (
          <div className="flex justify-start">
            <Button
              onClick={() => {
                openCreate();
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              مجموعه جدید
            </Button>
          </div>
        ) : null}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>{collectionForm}</Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {collections === null
            ? "در حال دریافت مجموعه‌ها…"
            : collections.length === 0
              ? "هنوز مجموعه‌ای ثبت نشده است."
              : `${faNum(collections.length)} مجموعه دانش ثبت شده است.`}
        </p>
        {canManageCollections ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            مجموعه جدید
          </Button>
        ) : null}
      </div>

      {collections === null ? (
        <ListSkeleton />
      ) : collections.length === 0 ? (
        <EmptyState
          icon={<FolderTree className="h-8 w-8" aria-hidden="true" />}
          title="اولین مجموعه دانش را بسازید"
          description="اسناد هر مجموعه فقط برای دپارتمان‌های مجاز همان مجموعه قابل جست‌وجو هستند."
        />
      ) : (
        <ul className="space-y-3">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Card className={collection.isActive ? "" : "opacity-70"}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{collection.name}</h3>
                        <CollectionAccessBadge access={collection.access} />
                        <Badge
                          variant="outline"
                          className={
                            collection.isActive
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "text-muted-foreground"
                          }
                        >
                          {collection.isActive ? "فعال" : "غیرفعال"}
                        </Badge>
                      </div>
                      {collection.description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{collection.description}</p>
                      ) : null}
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {faNum(collection.documentCount)} سند — مجموعه{" "}
                        {collection.access === "GLOBAL" ? "سازمانی" : "دپارتمانی/محدود"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">دپارتمان‌ها:</span>
                        <DepartmentChips departments={collection.departments} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {canManageCollections ? (
                        <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                          <Switch
                            checked={collection.isActive}
                            disabled={busyId === collection.id}
                            onCheckedChange={() => void toggleActive(collection)}
                            aria-label={`فعال‌سازی مجموعه ${collection.name}`}
                          />
                          <span className="text-xs">فعال</span>
                        </div>
                      ) : null}
                      {canManageCollections ? (
                        <Button variant="outline" size="sm" onClick={() => openEdit(collection)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ویرایش
                        </Button>
                      ) : null}
                      {canAssignDepartments ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setAssignTarget({
                              kind: "collection",
                              id: collection.id,
                              name: collection.name,
                              current: collection.departments.map((d) => d.id),
                            })
                          }
                        >
                          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                          انتساب دپارتمان‌ها
                        </Button>
                      ) : null}
                      {canManageCollections ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(collection)}
                          aria-label={`حذف مجموعه ${collection.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          حذف
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>{collectionForm}</Dialog>

      <DepartmentsAssignDialog
        target={assignTarget}
        departments={departments}
        onOpenChange={(open) => !open && setAssignTarget(null)}
        onSaved={() => void reload()}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف مجموعه دانش</AlertDialogTitle>
            <AlertDialogDescription>
              مجموعه «{deleteTarget?.name}» برای همیشه حذف می‌شود. در صورت وجود سند در مجموعه، حذف توسط سامانه
              پذیرفته نمی‌شود؛ ابتدا اسناد را حذف یا منتقل کنید.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------------------------------------------- Q&A tab --

function QaTab({
  permissions,
  departments,
}: {
  permissions: KbPermissions;
  departments: KbDepartmentRef[];
}) {
  const { toast } = useToast();
  const { canView, canAssignDepartments, canQaCreate, canQaEdit, canQaPublish } = permissions;

  const [entries, setEntries] = useState<KbQaEntry[] | null>(null);

  // create / edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    question: "",
    officialAnswer: "",
    category: "",
    keywordsInput: "",
    alternates: [] as string[],
    departmentIds: [] as string[],
    status: "DRAFT",
  });
  const [saving, setSaving] = useState(false);

  // department assignment
  const [assignTarget, setAssignTarget] = useState<{
    kind: "collection" | "qa";
    id: string;
    name: string;
    current: string[];
  } | null>(null);

  // delete
  const [deleteTarget, setDeleteTarget] = useState<KbQaEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    const res = await apiFetch<{ entries: KbQaEntry[] }>("/api/admin/kb/qa");
    if (res.ok) {
      setEntries(res.data.entries);
    } else {
      setEntries([]);
      toast({ title: "خطا در دریافت پرسش و پاسخ‌ها", description: res.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch<{ entries: KbQaEntry[] }>("/api/admin/kb/qa");
      if (cancelled) return;
      if (res.ok) setEntries(res.data.entries);
      else {
        setEntries([]);
        toast({ title: "خطا در دریافت پرسش و پاسخ‌ها", description: res.error, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, toast]);

  function emptyForm() {
    return {
      question: "",
      officialAnswer: "",
      category: "",
      keywordsInput: "",
      alternates: [] as string[],
      departmentIds: [] as string[],
      status: "DRAFT",
    };
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(entry: KbQaEntry) {
    setEditingId(entry.id);
    setForm({
      question: entry.question,
      officialAnswer: entry.officialAnswer,
      category: entry.category ?? "",
      keywordsInput: entry.keywords.join("، "),
      alternates: [...entry.alternates],
      departmentIds: entry.departments.map((d) => d.id),
      status: entry.status,
    });
    setDialogOpen(true);
  }

  function parseKeywords(): string[] {
    return form.keywordsInput
      .split(/[،,]/)
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)
      .slice(0, 12);
  }

  function cleanAlternates(): string[] | null {
    const cleaned = form.alternates.map((a) => a.trim()).filter((a) => a.length > 0);
    if (cleaned.length > 10) {
      toast({ title: "حداکثر ۱۰ پرسش جایگزین مجاز است.", variant: "destructive" });
      return null;
    }
    if (cleaned.some((a) => a.length < 3)) {
      toast({ title: "هر پرسش جایگزین باید حداقل ۳ کاراکتر باشد.", variant: "destructive" });
      return null;
    }
    return cleaned;
  }

  function toggleDepartment(id: string) {
    setForm((prev) => ({
      ...prev,
      departmentIds: prev.departmentIds.includes(id)
        ? prev.departmentIds.filter((d) => d !== id)
        : [...prev.departmentIds, id],
    }));
  }

  async function handleSave() {
    if (form.question.trim().length < 3) {
      toast({ title: "پرسش باید حداقل ۳ کاراکتر باشد.", variant: "destructive" });
      return;
    }
    if (!form.officialAnswer.trim()) {
      toast({ title: "پاسخ رسمی الزامی است.", variant: "destructive" });
      return;
    }
    if (form.departmentIds.length === 0) {
      toast({ title: "انتخاب حداقل یک دپارتمان الزامی است.", variant: "destructive" });
      return;
    }
    const alternates = cleanAlternates();
    if (alternates === null) return;
    const keywords = parseKeywords();
    if (form.keywordsInput.trim() && keywords.length === 0) {
      toast({ title: "کلیدواژه معتبری وارد نشده است.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const res = editingId
      ? await apiFetch<{ entry: KbQaEntry }>(`/api/admin/kb/qa/${editingId}`, apiJson("PATCH", {
          question: form.question.trim(),
          officialAnswer: form.officialAnswer.trim(),
          category: form.category.trim(),
          keywords,
          alternates,
        }))
      : await apiFetch<{ entry: KbQaEntry }>("/api/admin/kb/qa", apiJson("POST", {
          question: form.question.trim(),
          officialAnswer: form.officialAnswer.trim(),
          category: form.category.trim() || undefined,
          keywords: keywords.length > 0 ? keywords : undefined,
          alternates: alternates.length > 0 ? alternates : undefined,
          departmentIds: form.departmentIds,
          status: form.status,
        }));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "ذخیره پرسش و پاسخ ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "پرسش و پاسخ ویرایش شد" : "پرسش و پاسخ ایجاد شد" });
    setDialogOpen(false);
    void reload();
  }

  async function togglePublish(entry: KbQaEntry) {
    const publish = entry.status !== "PUBLISHED";
    const res = await apiFetch<{ id: string; status: string }>(
      `/api/admin/kb/qa/${entry.id}/publish`,
      apiJson("POST", { published: publish })
    );
    if (!res.ok) {
      toast({ title: "تغییر وضعیت انتشار ناموفق بود", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: publish ? "پرسش و پاسخ منتشر شد" : "انتشار لغو شد و به پیش‌نویس بازگشت",
    });
    void reload();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await apiFetch<{ deleted: boolean }>(`/api/admin/kb/qa/${deleteTarget.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!res.ok) {
      toast({ title: "حذف پرسش و پاسخ ناموفق بود", description: res.error, variant: "destructive" });
      setDeleteTarget(null);
      return;
    }
    toast({ title: "پرسش و پاسخ حذف شد" });
    setDeleteTarget(null);
    void reload();
  }

  const qaDialog = (
    <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editingId ? "ویرایش پرسش و پاسخ" : "پرسش و پاسخ جدید"}</DialogTitle>
        <DialogDescription>
          پاسخ رسمی، مرجع معتبر دستیار برای این پرسش است و در صورت تطابق، عیناً اولویت می‌گیرد.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-1">
        <div className="space-y-2">
          <Label htmlFor="kb-qa-question">پرسش</Label>
          <Input
            id="kb-qa-question"
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="مثلاً مرخصی استحقاقی چند روز است؟"
            maxLength={300}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kb-qa-answer">پاسخ رسمی</Label>
          <Textarea
            id="kb-qa-answer"
            value={form.officialAnswer}
            onChange={(e) => setForm({ ...form, officialAnswer: e.target.value })}
            placeholder="متن رسمی و تأییدشده پاسخ"
            rows={4}
            maxLength={8000}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="kb-qa-category">دسته‌بندی (اختیاری)</Label>
            <Input
              id="kb-qa-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="مثلاً منابع انسانی"
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-qa-keywords">کلیدواژه‌ها (با ویرگول جدا کنید)</Label>
            <Input
              id="kb-qa-keywords"
              value={form.keywordsInput}
              onChange={(e) => setForm({ ...form, keywordsInput: e.target.value })}
              placeholder="مرخصی، کارکنان، حکم"
              maxLength={600}
            />
            <p className="text-xs text-muted-foreground">حداکثر ۱۲ کلیدواژه.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>پرسش‌های جایگزین (اختیاری)</Label>
          {form.alternates.map((alternate, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={alternate}
                onChange={(e) => {
                  const next = [...form.alternates];
                  next[index] = e.target.value;
                  setForm({ ...form, alternates: next });
                }}
                placeholder="صورت دیگر همان پرسش"
                maxLength={300}
                aria-label={`پرسش جایگزین ${index + 1}`}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                onClick={() =>
                  setForm({ ...form, alternates: form.alternates.filter((_, i) => i !== index) })
                }
                aria-label={`حذف پرسش جایگزین ${index + 1}`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setForm({ ...form, alternates: [...form.alternates, ""] })}
            disabled={form.alternates.length >= 10}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            افزودن پرسش جایگزین
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <Label>دپارتمان‌های مرتبط</Label>
          <div className="max-h-44 overflow-y-auto scroll-slim">
            <ul className="space-y-2.5">
              {departments.length === 0 ? (
                <li className="text-xs text-muted-foreground">دپارتمان فعالی ثبت نشده است.</li>
              ) : (
                departments.map((d) => (
                  <li key={d.id} className="flex items-center gap-2.5 text-sm">
                    <Checkbox
                      id={`kb-qa-dept-${editingId ?? "new"}-${d.id}`}
                      checked={form.departmentIds.includes(d.id)}
                      onCheckedChange={() => toggleDepartment(d.id)}
                    />
                    <Label htmlFor={`kb-qa-dept-${editingId ?? "new"}-${d.id}`} className="cursor-pointer font-normal">
                      {d.name}
                    </Label>
                  </li>
                ))
              )}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">حداقل یک دپارتمان لازم است (حداکثر ۲۰ مورد).</p>
        </div>

        {!editingId ? (
          <div className="space-y-2">
            <Label htmlFor="kb-qa-status">وضعیت اولیه</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger id="kb-qa-status" className="w-full" aria-label="وضعیت اولیه">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">پیش‌نویس</SelectItem>
                <SelectItem value="PUBLISHED" disabled={!canQaPublish}>
                  منتشرشده (نیازمند مجوز انتشار)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              انتشار بعدی از طریق دکمه انتشار در فهرست انجام می‌شود.
            </p>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
          انصراف
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          ذخیره
        </Button>
      </DialogFooter>
    </DialogContent>
  );

  if (!canView) {
    return (
      <div className="space-y-4">
        <LockedState note="مشاهده فهرست پرسش و پاسخ نیاز به مجوز kb.view دارد." />
        {canQaCreate ? (
          <div className="flex justify-start">
            <Button
              onClick={() => {
                openCreate();
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              پرسش و پاسخ جدید
            </Button>
          </div>
        ) : null}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>{qaDialog}</Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {entries === null
            ? "در حال دریافت فهرست…"
            : entries.length === 0
              ? "هنوز پرسش و پاسخی ثبت نشده است."
              : `${faNum(entries.length)} مورد ثبت شده است — فقط موارد منتشرشده در پاسخ‌گویی استفاده می‌شوند.`}
        </p>
        {canQaCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            پرسش و پاسخ جدید
          </Button>
        ) : null}
      </div>

      {entries === null ? (
        <ListSkeleton />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="h-8 w-8" aria-hidden="true" />}
          title="اولین پرسش و پاسخ رسمی را ثبت کنید"
          description="پاسخ‌های رسمی در تطابق معنایی از همه منابع دیگر اولویت دارند و عیناً ارائه می‌شوند."
        />
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold" dir="auto">{entry.question}</h3>
                        <QaStatusBadge status={entry.status} />
                        {entry.category ? (
                          <Badge variant="secondary" className="text-[11px] font-normal">
                            {entry.category}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-muted-foreground" dir="auto">
                        {entry.officialAnswer}
                      </p>
                      {entry.keywords.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {entry.keywords.map((keyword) => (
                            <Badge key={keyword} variant="outline" className="text-[11px] font-normal">
                              {keyword}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {entry.alternates.length > 0 ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {faNum(entry.alternates.length)} پرسش جایگزین ثبت شده است.
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">دپارتمان‌ها:</span>
                        <DepartmentChips departments={entry.departments} />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        ثبت‌کننده: {entry.createdByName} — آخرین تغییر:{" "}
                        {faDateTimeFormat(entry.updatedAt)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {canQaEdit ? (
                        <Button variant="outline" size="sm" onClick={() => openEdit(entry)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          ویرایش
                        </Button>
                      ) : null}
                      {canQaPublish ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void togglePublish(entry)}
                          className={
                            entry.status === "PUBLISHED" ? "" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          }
                        >
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                          {entry.status === "PUBLISHED" ? "لغو انتشار" : "انتشار"}
                        </Button>
                      ) : null}
                      {canAssignDepartments ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setAssignTarget({
                              kind: "qa",
                              id: entry.id,
                              name: entry.question,
                              current: entry.departments.map((d) => d.id),
                            })
                          }
                        >
                          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                          انتساب دپارتمان‌ها
                        </Button>
                      ) : null}
                      {canQaPublish ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(entry)}
                          aria-label={`حذف پرسش و پاسخ ${entry.question}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          حذف
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>{qaDialog}</Dialog>

      <DepartmentsAssignDialog
        target={assignTarget}
        departments={departments}
        onOpenChange={(open) => !open && setAssignTarget(null)}
        onSaved={() => void reload()}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف پرسش و پاسخ</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteTarget?.question}» برای همیشه حذف می‌شود؛ پرسش‌های جایگزین و انتساب‌های دپارتمان نیز پاک
              می‌شوند و این عمل در گزارش حسابرسی ثبت خواهد شد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              حذف قطعی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
