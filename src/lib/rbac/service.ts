import { db } from "@/lib/db";
import { cacheGet, cacheSet, cacheDelete, cacheDeletePrefix } from "@/lib/cache";

/**
 * Effective permission resolution — deny-by-default RBAC.
 *
 * effective(user, key) =
 *   override(user, key)            // DENY always wins, ALLOW grants
 *   ?? (roleBinding(user.role, key))
 *
 * Results are cached briefly (L1 in-process + shared L2 via the cache layer)
 * to keep authorization cheap on hot paths while staying fresh after
 * role/override changes.
 */

export type EffectivePermissions = Set<string>;

const CACHE_TTL_MS = 30_000;
const SHARED_TTL_MS = 60_000;
const KEY_PREFIX = "rbac:perm:";

const cache = new Map<
  string,
  { permissions: EffectivePermissions; loadedAt: number }
>();

function sharedKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function invalidateUser(userId: string) {
  cache.delete(`user:${userId}`);
  void cacheDelete(sharedKey(userId));
}

export function invalidateUserPermissions(userId?: string) {
  if (userId) invalidateUser(userId);
  else {
    cache.clear();
    void cacheDeletePrefix(KEY_PREFIX);
  }
}

export async function getEffectivePermissions(
  userId: string
): Promise<EffectivePermissions> {
  const cacheKey = `user:${userId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) {
    return hit.permissions;
  }

  // Shared L2 (multi-instance) before recomputing from the DB.
  const shared = await cacheGet<string[]>(sharedKey(userId));
  if (shared) {
    const permissions = new Set<string>(shared);
    cache.set(cacheKey, { permissions, loadedAt: Date.now() });
    return permissions;
  }

  const [roleKeys, overrides] = await Promise.all([
    // Role permissions via the user's role
    db.user
      .findUnique({
        where: { id: userId },
        select: { roleKey: true },
      })
      .then((u) =>
        u
          ? db.rolePermission.findMany({
              where: { roleKey: u.roleKey },
              select: { permissionKey: true },
            })
          : []
      ),
    db.userPermissionOverride.findMany({
      where: { userId },
      select: { permissionKey: true, effect: true },
    }),
  ]);

  const permissions = new Set<string>();
  for (const rp of roleKeys) permissions.add(rp.permissionKey);

  for (const o of overrides) {
    if (o.effect === "DENY") permissions.delete(o.permissionKey);
    else if (o.effect === "ALLOW") permissions.add(o.permissionKey);
  }

  cache.set(cacheKey, { permissions, loadedAt: Date.now() });
  void cacheSet(sharedKey(userId), [...permissions], SHARED_TTL_MS);
  return permissions;
}

export async function can(
  userId: string,
  permissionKey: string
): Promise<boolean> {
  const permissions = await getEffectivePermissions(userId);
  return permissions.has(permissionKey);
}

/**
 * Best landing workspace for a freshly authenticated staff user. Precedence:
 * admin dashboard (admins land on their control panel) → support desk →
 * file hub → admin (fallback shows the honest access-denied panel). Operators
 * never land on a denied dashboard because they lack `admin.dashboard.view`.
 */
export async function resolveLandingPath(userId: string): Promise<string> {
  if (await can(userId, "admin.dashboard.view")) return "/admin";
  if (await can(userId, "tickets.view")) return "/support";
  if (await can(userId, "files.access")) return "/files";
  return "/admin";
}

/** Load a user's permissions with labels for UI display. */
export async function getUserPermissionDisplay(userId: string) {
  const effective = await getEffectivePermissions(userId);
  const { PERMISSION_CATALOG } = await import("./permissions");
  return PERMISSION_CATALOG.map((p) => ({
    ...p,
    granted: effective.has(p.key),
  }));
}
