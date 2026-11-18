import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, assertSameOrigin, parseBody, requestMeta } from "@/lib/api";
import { createConversation, getCustomerConversation } from "@/lib/conversations/service";
import { CONVERSATION_MODE_LABELS } from "@/lib/conversations/types";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  departmentId: z.string().min(5).max(64),
  customerName: z.string().max(80).optional(),
  /** Phase 8 — citizen identity (کد ملی + password) required for every chat. */
  nationalId: z.string().min(4).max(20),
  password: z.string().min(1).max(128),
});

/**
 * POST /api/public/conversations — start a customer conversation against a
 * public, active department. Identity (کد ملی + password) is REQUIRED: the
 * first contact registers the citizen account, returning citizens log in.
 * No session: the returned resume token is the only customer-side
 * identifier (never expose the internal conversation id).
 */
export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const parsed = await parseBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const meta = requestMeta(req);
    const result = await createConversation({
      departmentId: parsed.data.departmentId,
      customerName: parsed.data.customerName ?? null,
      nationalId: parsed.data.nationalId,
      password: parsed.data.password,
      meta,
    });
    if (!result.ok) return apiError(result.error, result.status);

    // Include the SYSTEM welcome message so the client renders one
    // fetch-free view right after creation.
    const view = await getCustomerConversation(result.data.token);
    if (!view.ok) {
      return apiError(view.error, view.status);
    }

    return apiOk(
      {
        token: result.data.token,
        mode: result.data.mode,
        modeLabel: CONVERSATION_MODE_LABELS[result.data.mode],
        departmentName: result.data.departmentName,
        messages: view.data.messages,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[api/public/conversations] create failed:", error);
    return apiError("خطای غیرمنتظره در پردازش درخواست.", 500);
  }
}
