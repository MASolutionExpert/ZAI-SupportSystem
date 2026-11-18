import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiOk,
  assertSameOrigin,
  parseBody,
  requireAuth,
  requestMeta,
} from "@/lib/api";
import { changeOwnAvailability } from "@/lib/admin/users";

const schema = z.object({ isAvailable: z.boolean() });

/**
 * POST /api/staff/availability — an operator toggles their own availability
 * for fair distribution (consulted by the assignment engine in Phase 4).
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const result = await changeOwnAvailability(
    guard.user.id,
    parsed.data.isAvailable,
    { id: guard.user.id, username: guard.user.username },
    requestMeta(req)
  );

  return apiOk({ isAvailable: parsed.data.isAvailable, ...result });
}
