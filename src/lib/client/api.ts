/**
 * Client-side fetch helper for the API envelope
 * ({ ok: true, data } | { ok: false, error }).
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function apiFetch<T>(
  url: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        error: body?.error ?? "خطای غیرمنتظره در ارتباط با سرور.",
      };
    }
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, error: "ارتباط با سرور برقرار نشد." };
  }
}

export function apiJson(method: string, payload: unknown): RequestInit {
  return { method, body: JSON.stringify(payload) };
}
