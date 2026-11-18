import { rateLimit } from "@/lib/auth/throttle";

/**
 * Conversation rate limiting — thin wrapper over the generic in-memory
 * sliding-window limiter (src/lib/auth/throttle.ts) so conversation flows do
 * not re-implement it.
 *
 * Same honesty note as login throttling: per-process memory only, acceptable
 * for the single-node v1 deployment; replace with a shared store when the app
 * is deployed behind multiple replicas.
 */

/** true = allowed. Registers the event inside the window when allowed. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  return rateLimit(key, { limit, windowMs }).allowed;
}
