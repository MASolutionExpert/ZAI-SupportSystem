import { NextRequest } from "next/server";
import { apiOk, assertSameOrigin, requestMeta } from "@/lib/api";
import { resolveSession, revokeCurrentSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const originGuard = assertSameOrigin(req);
  if (originGuard) return originGuard;

  const resolved = await resolveSession();
  const revoked = await revokeCurrentSession();

  if (resolved && revoked) {
    const meta = requestMeta(req);
    await audit({
      actorType: "USER",
      actorUserId: resolved.user.id,
      actorLabel: resolved.user.username,
      action: "auth.logout",
      entityType: "session",
      entityId: resolved.sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  return apiOk({ loggedOut: true });
}
