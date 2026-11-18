/**
 * In-memory sliding-window rate limiter (per system requirements no external
 * cache middleware is used in v1 — local memory cache only).
 *
 * Suitable for a single-node deployment. If multiple app replicas are ever
 * deployed behind a load balancer, replace with a shared store (documented in
 * ARCHITECTURE.md).
 */

type Bucket = {
  /** Timestamps (ms) of events inside the current window. */
  hits: number[];
};

const buckets = new Map<string, Bucket>();

let lastSweep = Date.now();

function sweep(now: number, windowMs: number) {
  // Cheap periodic sweep to keep memory bounded.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  sweep(now, options.windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < options.windowMs);

  if (bucket.hits.length >= options.limit) {
    const oldest = bucket.hits[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((options.windowMs - (now - oldest)) / 1000)
    );
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: options.limit - bucket.hits.length,
    retryAfterSeconds: 0,
  };
}

/* Test/ops helper — not exposed through any API. */
export function clearRateLimits(): void {
  buckets.clear();
}
