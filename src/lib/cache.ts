import "server-only";

import type { Redis as RedisClient } from "ioredis";

/**
 * Shared cache layer (v0.10.0) — two tiers, graceful degradation.
 *
 *   L1  per-process memory      — always present, zero network latency
 *   L2  Redis (REDIS_URL)       — shared across app instances/containers,
 *                                 survives process restarts, TTL-managed
 *
 * Design rules:
 *  - The cache is a performance layer only: every consumer must be able to
 *    work with L1 alone. Redis being unreachable, misconfigured or absent
 *    NEVER fails a request — read paths fall back to L1, write paths become
 *    no-ops (logged once, loudly).
 *  - Values are JSON-serialized (TypedArrays/Maps are not supported; store
 *    plain objects/arrays — Sets and other structures serialize explicitly
 *    at the call site).
 *  - All keys are namespaced under "sd:cache:" so the Redis instance can be
 *    shared with other infrastructure safely.
 *  - L1 entries expire lazily (on read) and via a periodic sweep, bounding
 *    memory even for write-heavy key spaces.
 */

const KEY_PREFIX = "sd:cache:";
const L1_SWEEP_INTERVAL_MS = 60_000;
/** L1 cap — beyond this, expired-entry sweeps keep the map bounded. */
const L1_MAX_ENTRIES = 2_000;

type L1Entry = {
  value: string;
  expiresAt: number;
};

const l1 = new Map<string, L1Entry>();

type RedisStatus = "disabled" | "connecting" | "ready" | "error";

let redisUrl: string | null = process.env.REDIS_URL?.trim() || null;
let redisStatus: RedisStatus = redisUrl ? "connecting" : "disabled";
let redis: RedisClient | null = null;
let loggedRedisError = false;

async function getRedis(): Promise<RedisClient | null> {
  if (!redisUrl) return null;
  if (redisStatus === "ready" && redis) return redis;
  if (redisStatus === "error") return null; // stay degraded until restart
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      // Fail fast instead of queueing commands while disconnected.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      retryStrategy: (attempt: number) => Math.min(attempt * 1_000, 10_000),
    });
    client.on("ready", () => {
      redisStatus = "ready";
      loggedRedisError = false;
      console.log("[cache] Redis connected — shared L2 cache active.");
    });
    client.on("error", (error: unknown) => {
      redisStatus = "error";
      redis = null;
      // Tear the client down: an open socket or a pending reconnect loop would
      // keep the event loop (and therefore CLI scripts) alive forever.
      try {
        client.disconnect();
      } catch {
        // ignore
      }
      if (!loggedRedisError) {
        loggedRedisError = true;
        console.warn(
          "[cache] Redis unavailable — continuing with the in-process L1 cache only.",
          error instanceof Error ? error.message : error
        );
      }
    });
    redis = client;
    // Await readiness briefly so early writes can reach L2 when Redis is up.
    if (client.status !== "ready") {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        client.once("ready", done);
        client.once("error", done);
        const timer = setTimeout(done, 3_000);
        (timer as { unref?: () => void }).unref?.();
      });
      if (redisStatus !== "ready") {
        // Half-open connect (hung socket, unreachable host): kill the client so
        // no pending reconnect machinery survives; degraded until restart.
        redisStatus = "error";
        redis = null;
        try {
          client.disconnect();
        } catch {
          // ignore
        }
        if (!loggedRedisError) {
          loggedRedisError = true;
          console.warn("[cache] Redis did not become ready in time — continuing with the in-process L1 cache only.");
        }
        return null;
      }
    }
    return redisStatus === "ready" ? redis : null;
  } catch (error) {
    redisStatus = "error";
    redis = null;
    if (!loggedRedisError) {
      loggedRedisError = true;
      console.warn(
        "[cache] Redis client init failed — continuing with the in-process L1 cache only.",
        error instanceof Error ? error.message : error
      );
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// L1 helpers
// ---------------------------------------------------------------------------

function l1Get(key: string): string | null {
  const entry = l1.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    l1.delete(key);
    return null;
  }
  return entry.value;
}

function l1Set(key: string, value: string, ttlMs: number): void {
  if (l1.size >= L1_MAX_ENTRIES) sweepL1();
  l1.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
}

function sweepL1(): void {
  const now = Date.now();
  for (const [key, entry] of l1) {
    if (now >= entry.expiresAt) l1.delete(key);
  }
}

// Keep the sweep timer unref'd so it never blocks process exit.
if (typeof setInterval === "function") {
  const timer = setInterval(sweepL1, L1_SWEEP_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read a cached JSON value: L1 first, then L2 (Redis) when available. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const fullKey = KEY_PREFIX + key;

  const local = l1Get(fullKey);
  if (local !== null) {
    try {
      return JSON.parse(local) as T;
    } catch {
      l1.delete(fullKey); // corrupted entry — drop it
    }
  }

  const client = await getRedis();
  if (!client) return null;
  try {
    const raw = await client.get(fullKey);
    if (raw === null || raw === undefined) return null;
    // Hydrate L1 with the remaining TTL so subsequent reads stay local.
    const ttlMs = await client.pttl(fullKey);
    if (typeof ttlMs === "number" && ttlMs > 0) l1Set(fullKey, raw, ttlMs);
    return JSON.parse(raw) as T;
  } catch {
    return null; // Redis hiccup — treated as a miss
  }
}

/** Write a JSON value to both tiers. Never throws. */
export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const fullKey = KEY_PREFIX + key;
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return; // non-serializable value — cache skipped
  }
  l1Set(fullKey, raw, ttlMs);

  const client = await getRedis();
  if (!client) return;
  try {
    await client.set(fullKey, raw, "PX", Math.max(1, Math.floor(ttlMs)));
  } catch {
    // L2 write failure is non-fatal — L1 already holds the value.
  }
}

/** Invalidate one key in both tiers. Never throws. */
export async function cacheDelete(key: string): Promise<void> {
  const fullKey = KEY_PREFIX + key;
  l1.delete(fullKey);
  const client = await getRedis();
  if (!client) return;
  try {
    await client.del(fullKey);
  } catch {
    // ignore
  }
}

/** Invalidate every key under a logical prefix, in both tiers. Never throws. */
export async function cacheDeletePrefix(prefix: string): Promise<void> {
  const fullPrefix = KEY_PREFIX + prefix;
  for (const key of [...l1.keys()]) {
    if (key.startsWith(fullPrefix)) l1.delete(key);
  }
  const client = await getRedis();
  if (!client) return;
  try {
    const stream = client.scanStream({ match: `${fullPrefix}*`, count: 200 });
    const batch: string[] = [];
    for await (const keys of stream) {
      batch.push(...keys);
      if (batch.length >= 500) {
        await client.del(...batch.splice(0));
      }
    }
    if (batch.length > 0) await client.del(...batch);
  } catch {
    // ignore — best-effort invalidation
  }
}

/**
 * Operational status for the health endpoint and diagnostics. `backend`
 * reports the effective shared-tier: "redis" when connected, otherwise the
 * in-process "memory" fallback.
 */
export function getCacheStatus(): {
  backend: "redis" | "memory";
  redisStatus: RedisStatus;
  l1Entries: number;
} {
  return {
    backend: redisStatus === "ready" ? "redis" : "memory",
    redisStatus,
    l1Entries: l1.size,
  };
}

/** Close the Redis connection (tests / graceful shutdown). */
export async function shutdownCache(): Promise<void> {
  if (redis) {
    try {
      await redis.quit();
    } catch {
      // ignore
    }
    redis = null;
  }
  redisStatus = redisUrl ? "connecting" : "disabled";
}
