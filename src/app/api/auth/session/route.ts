import { apiOk } from "@/lib/api";
import { resolveSession } from "@/lib/auth/session";

/** Current session probe — returns minimal, non-sensitive identity data. */
export async function GET() {
  const resolved = await resolveSession();
  if (!resolved) {
    return apiOk({ authenticated: false as const });
  }
  return apiOk({
    authenticated: true as const,
    user: {
      id: resolved.user.id,
      username: resolved.user.username,
      name: resolved.user.name,
      roleKey: resolved.user.roleKey,
    },
    mustChangePassword: resolved.user.mustChangePassword,
  });
}
