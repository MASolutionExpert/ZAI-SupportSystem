# PERMISSIONS.md — Support Desk

Status: Phase 2 — the permission catalog, system roles, and the authorization engine are **implemented**, and the **Phase 2 management UIs are live**: role management, role↔permission bindings, and per-user overrides (`/admin/roles`), plus operator management with department memberships (`/admin/users`). Enforcement runs in backend guards (`requireAuth` / `requirePermission` in `src/lib/api.ts`, also used by server components) and the department-scope layer of §6 is implemented in `src/lib/rbac/scope.ts`. Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [DATABASE.md](DATABASE.md).

---

## 1. Model overview

```
Permission catalog (src/lib/rbac/permissions.ts — constants, 52 keys)
        │ seeded at bootstrap into the Permission table
        ▼
Role ──(RolePermission)──▶ Permission          User ──(UserPermissionOverride)──▶ Permission
   SUPER_ADMIN / OPERATOR / FILE_MANAGER          per-user ALLOW / DENY (takes precedence)

Effective permissions of a user = (permissions of the user's role) ∪ (user overrides)
  → a DENY override removes a permission even if the role grants it
  → anything not granted is denied (deny-by-default)
```

Hard rules:

- **No permission is ever implied by a role name.** Every check consults the catalog; SUPER_ADMIN itself is bound to all catalog keys through explicit `RolePermission` rows (re-synced at every bootstrap so new permissions arrive with upgrades).
- **Deny by default.** Absence of a grant is a denial.
- **DENY wins.** A user-level `DENY` override beats a role binding; a user-level `ALLOW` adds a permission the role lacks.
- **Enforced server-side** in API route handlers and server components — never by hiding UI elements (spec §9.4/§11).

---

## 2. Permission catalog

Categories: `ADMIN` (administration), `SUPPORT` (helpdesk/ticketing), `FILES` (shared file hub), `KB` (knowledge base), `AI` (AI settings & usage). Source of truth: `src/lib/rbac/permissions.ts`; the catalog is seeded into the `Permission` table at bootstrap.

### ADMIN — Administration (پنل مدیریت)

| Key | Purpose | Persian meaning |
|---|---|---|
| `admin.dashboard.view` | View the admin dashboard and system status | مشاهده داشبورد مدیریت |
| `admin.users.manage` | Create/edit/activate/suspend user accounts | مدیریت کاربران |
| `admin.departments.manage` | Create/edit departments, ordering, visibility, AI toggle | مدیریت دپارتمان‌ها |
| `admin.roles.manage` | Create and edit roles | مدیریت نقش‌ها |
| `admin.permissions.manage` | Bind permissions to roles and manage overrides | مدیریت مجوزها |
| `admin.settings.manage` | Manage system settings (e.g. `org.name`) | مدیریت تنظیمات سامانه |
| `admin.storage.manage` | Manage storage structure and limits | مدیریت فضای ذخیره‌سازی |
| `admin.audit.view` | View the audit log | مشاهده گزارش‌های حسابرسی |
| `admin.integrations.manage` | Manage integrations | مدیریت یکپارچه‌سازی‌ها |
| `admin.backups.manage` | Manage backups, where supported | مدیریت پشتیبان‌گیری |

### SUPPORT — Helpdesk / Ticketing (میز کمک و تیکتینگ)

| Key | Purpose | Persian meaning |
|---|---|---|
| `tickets.view` | View tickets (scoped per §6) | مشاهده تیکت‌ها |
| `tickets.view.all` | View tickets across all departments | مشاهده همه تیکت‌ها |
| `tickets.view.department` | View tickets of the operator's authorized departments | مشاهده تیکت‌های دپارتمان |
| `tickets.create.internal` | Create tickets from inside the staff workspace | ایجاد تیکت داخلی |
| `tickets.reply` | Reply to tickets | پاسخ به تیکت‌ها |
| `tickets.notes.add` | Add internal notes (never visible to customers or AI retrieval) | افزودن یادداشت داخلی |
| `tickets.status.change` | Change ticket status | تغییر وضعیت تیکت |
| `tickets.assign` | Assign tickets to operators | تخصیص تیکت |
| `tickets.transfer` | Transfer tickets between departments | انتقال تیکت بین دپارتمان‌ها |
| `tickets.customer.history.view` | View a customer's previous conversations | مشاهده تاریخچه مشتری |
| `tickets.export` | Export ticket data | خروجی گرفتن از تیکت‌ها |
| `tickets.delete` | Delete/archive tickets (explicit authorization only) | حذف تیکت |

### FILES — Shared File Hub (فایل‌های مشترک)

| Key | Purpose | Persian meaning |
|---|---|---|
| `files.access` | Access the file workspace at all | دسترسی به فضای فایل‌ها |
| `files.view` | View files/folders | مشاهده فایل‌ها |
| `files.download` | Download files | دانلود فایل |
| `files.upload` | Upload files | بارگذاری فایل |
| `files.folders.create` | Create folders (and rename folders/files) | ایجاد پوشه |
| `files.rename` | Rename files and folders | تغییر نام فایل/پوشه |
| `files.metadata.edit` | Edit file details/metadata | ویرایش اطلاعات فایل |
| `files.replace` | Replace a file with a new version (safe replacement) | جایگزینی فایل |
| `files.move` | Move files/folders between locations | جابه‌جایی فایل |
| `files.delete` | Delete files/folders | حذف فایل |
| `files.department.manage` | Manage files of the operator's own authorized department(s) | مدیریت فایل‌های دپارتمان خود |
| `files.all.manage` | Manage files across all departments | مدیریت فایل‌های همه دپارتمان‌ها |
| `files.quotas.manage` | Set storage quotas and limits | مدیریت سهمیه فضای ذخیره‌سازی |

### KB — Knowledge Base (مخزن دانش)

| Key | Purpose | Persian meaning |
|---|---|---|
| `kb.access` | Access the knowledge base workspace | دسترسی به مخزن دانش |
| `kb.view` | View knowledge entries and documents | مشاهده محتوای دانش |
| `kb.qa.create` | Create Q&A entries | ایجاد پرسش و پاسخ |
| `kb.qa.edit` | Edit Q&A entries | ویرایش پرسش و پاسخ |
| `kb.qa.publish` | Publish/unpublish Q&A entries | انتشار پرسش و پاسخ |
| `kb.documents.upload` | Upload documents for indexing | بارگذاری سند |
| `kb.documents.delete` | Delete documents and their index records | حذف سند |
| `kb.documents.reprocess` | Reprocess documents after changes | پردازش مجدد سند |
| `kb.collections.manage` | Manage knowledge collections | مدیریت مجموعه‌های دانش |
| `kb.departments.assign` | Assign knowledge/documents to departments | تخصیص دانش به دپارتمان‌ها |

### AI — AI settings & usage (تنظیمات هوش مصنوعی)

| Key | Purpose | Persian meaning |
|---|---|---|
| `ai.settings.access` | Access the AI settings page | دسترسی به تنظیمات هوش مصنوعی |
| `ai.provider.configure` | Configure provider name / Base URL | پیکربندی سرویس‌دهنده هوش مصنوعی |
| `ai.credentials.update` | Update API credentials (encrypted at rest, masked display) | به‌روزرسانی اعتبارنامه‌ها (کلید API) |
| `ai.models.select` | Select chat/embedding models | انتخاب مدل‌ها |
| `ai.connection.test` | Run connection tests | آزمایش اتصال |
| `ai.department.settings.manage` | Configure per-department AI behavior | مدیریت تنظیمات هوش مصنوعی دپارتمان |
| `ai.usage.view` | View AI usage reports | مشاهده گزارش مصرف هوش مصنوعی |

---

## 3. System roles and role binding matrix

Seeded at bootstrap with `isSystem = true` (deny-by-default; nothing is implied by the name):

| Role | Description |
|---|---|
| `SUPER_ADMIN` | Automatically bound to **all** catalog permissions; bindings re-synced at every bootstrap so upgraded catalogs arrive with new permissions. |
| `OPERATOR` | Front-line helpdesk staff: works their authorized departments' tickets and the shared files. |
| `FILE_MANAGER` | Manages the Shared File Hub across departments (all `files.*`). |

Legend: ✅ = bound · — = not bound. (Per-user `ALLOW`/`DENY` overrides can change any of this per account.)

| Permission key | SUPER_ADMIN | OPERATOR | FILE_MANAGER |
|---|:---:|:---:|:---:|
| `admin.dashboard.view` | ✅ | — | — |
| `admin.users.manage` | ✅ | — | — |
| `admin.departments.manage` | ✅ | — | — |
| `admin.roles.manage` | ✅ | — | — |
| `admin.permissions.manage` | ✅ | — | — |
| `admin.settings.manage` | ✅ | — | — |
| `admin.storage.manage` | ✅ | — | — |
| `admin.audit.view` | ✅ | — | — |
| `admin.integrations.manage` | ✅ | — | — |
| `admin.backups.manage` | ✅ | — | — |
| `tickets.view` | ✅ | ✅ | — |
| `tickets.view.all` | ✅ | — | — |
| `tickets.view.department` | ✅ | ✅ | — |
| `tickets.create.internal` | ✅ | — | — |
| `tickets.reply` | ✅ | ✅ | — |
| `tickets.notes.add` | ✅ | ✅ | — |
| `tickets.status.change` | ✅ | ✅ | — |
| `tickets.assign` | ✅ | — | — |
| `tickets.transfer` | ✅ | — | — |
| `tickets.customer.history.view` | ✅ | — | — |
| `tickets.export` | ✅ | — | — |
| `tickets.delete` | ✅ | — | — |
| `files.access` | ✅ | ✅ | ✅ |
| `files.view` | ✅ | ✅ | ✅ |
| `files.download` | ✅ | ✅ | ✅ |
| `files.upload` | ✅ | ✅ | ✅ |
| `files.folders.create` | ✅ | — | ✅ |
| `files.rename` | ✅ | — | ✅ |
| `files.metadata.edit` | ✅ | — | ✅ |
| `files.replace` | ✅ | — | ✅ |
| `files.move` | ✅ | — | ✅ |
| `files.delete` | ✅ | — | ✅ |
| `files.department.manage` | ✅ | — | ✅ |
| `files.all.manage` | ✅ | — | ✅ |
| `files.quotas.manage` | ✅ | — | ✅ |
| `kb.access` | ✅ | — | — |
| `kb.view` | ✅ | ✅ | — |
| `kb.qa.create` | ✅ | — | — |
| `kb.qa.edit` | ✅ | — | — |
| `kb.qa.publish` | ✅ | — | — |
| `kb.documents.upload` | ✅ | — | — |
| `kb.documents.delete` | ✅ | — | — |
| `kb.documents.reprocess` | ✅ | — | — |
| `kb.collections.manage` | ✅ | — | — |
| `kb.departments.assign` | ✅ | — | — |
| `ai.settings.access` | ✅ | — | — |
| `ai.provider.configure` | ✅ | — | — |
| `ai.credentials.update` | ✅ | — | — |
| `ai.models.select` | ✅ | — | — |
| `ai.connection.test` | ✅ | — | — |
| `ai.department.settings.manage` | ✅ | — | — |
| `ai.usage.view` | ✅ | — | — |

Note: ticket/file *visibility scope* (which department's data an operator may touch) is a separate mechanism layered on top of these permissions — see §6. A permission key grants the capability; department membership grants the scope.

---

## 4. Effective-permission algorithm

Implemented in `src/lib/rbac/service.ts` (result cached 30 s):

```
effectivePermissions(userId):
  1. user  = User(userId), must have status = ACTIVE
  2. rolePerms = RolePermission(roleKey = user.roleKey)          # the user's single role
  3. overrides = UserPermissionOverride(userId)                  # ALLOW / DENY per key
  4. result = { all keys k in catalog:
                 effect = override(k) ?? (k ∈ rolePerms ? ALLOW : DEFAULT_DENY) }
     → an explicit DENY override removes a role grant
     → an explicit ALLOW override grants what the role lacks
     → ungranted keys are denied (deny-by-default)
  5. cache the result for 30 s (invalidated by management actions in Phase 2)
```

`hasPermission(userId, key)` is `true` **only** when the computed effect for `key` is ALLOW. There is no wildcard, no prefix match, and no role-name shortcut: if the key is not in the catalog, it does not exist and the check denies.

---

## 5. Enforcement in code

| Layer | Mechanism |
|---|---|
| API route handlers | Handler calls `requireAuth()` (valid session → user) then `requirePermission("<key>")` from `src/lib/api.ts`; failure → 401/403 via the shared response envelope; authorization denials are audited. |
| Server components | The same guard pair authorizes page rendering (e.g. `/admin` requires `admin.dashboard.view`), so UI and APIs share one authorization truth. |
| UI | Components may check permissions to hide controls, but this is **cosmetic only** — the backend guard is the security boundary (spec §9.4). |
| Future services (Phases 2–5) | Domain services re-check permissions *and* department scope before touching data (e.g. `tickets.reply` + department membership). |

---

## 6. Department scoping — how the keys will be used in Phase 2+

The catalog is designed so that *capability* keys combine with `DepartmentMembership` rows to produce *scoped* authority:

| Scenario | Required permission | Required scope | Effective result |
|---|---|---|---|
| Operator replies to a ticket | `tickets.reply` | Membership in the ticket's department | Allowed only for their departments |
| Operator reads every ticket | `tickets.view.all` | none (cross-department by design) | All departments |
| Operator lists department queue | `tickets.view.department` | Membership | Only authorized departments |
| Manager sees own department's files | `files.department.manage` | Membership | Manage own-department files |
| Super admin reorganizes all files | `files.all.manage` | none | All departments |
| Operator downloads shared files of another department | `files.download` + `files.view` | Read policy configured for that department (Phase 5) | View/download without edit rights |
| Operator tries to edit another department's file | any `files.*` write key | Membership in that department | **Denied** — enforced by backend, not UI |

Planned Phase 2 test (per the master spec): an operator cannot access another department's tickets by manipulating a URL or API request, cannot reassign tickets to unauthorized departments, and department managers may hold extra authority within their department only.

---

## 7. Adding a new permission

1. **Add the key** to the catalog constants in `src/lib/rbac/permissions.ts` with its category (and Persian meaning for docs/UI). Keys use the `domain.action` / `domain.qualifier.action` naming seen above.
2. **Bootstrap re-syncs automatically**: the next start (with `BOOTSTRAP_ON_STARTUP=true`, the default) or an explicit `bun run bootstrap` seeds the new `Permission` row and re-binds all catalog keys to `SUPER_ADMIN` — the super admin gains it with zero manual steps.
3. **Bind to roles**: add a `RolePermission` row for each role that should hold it (role/permission management UI arrives in Phase 2; until then this is a migration/scripted change reviewed in code). Grant per-user exceptions, when needed, via `UserPermissionOverride` (ALLOW/DENY).
4. **Enforce it**: call `requirePermission("<key>")` in the new API route handler and/or server component. A permission that is defined but never checked must not exist.

---

## 8. Data model reference

| Table | Purpose |
|---|---|
| `Permission` | Catalog rows: `key` (PK), `category`, `description`. Seeded/updated by bootstrap. |
| `Role` | `key` (PK, e.g. `SUPER_ADMIN`), Persian `name`, `isSystem` flag. |
| `RolePermission` | Composite PK (`roleKey`, `permissionKey`); cascades on both sides. |
| `UserPermissionOverride` | Per-user row: `userId` + `permissionKey` (unique together), `effect` = ALLOW/DENY, optional `note`. |
| `User.roleKey` | Every staff user has exactly one role; department memberships add scope (Phase 2). |

Full field-level reference: [DATABASE.md](DATABASE.md).
