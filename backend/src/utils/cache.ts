import { createClient, type RedisClientType } from 'redis'
import { env } from '../config/env'
import { logger } from '../config/logger'

/**
 * Small read-through cache for the public catalog queries.
 *
 * WHY: the storefront product listing, product detail and category listing are
 * the three hottest read paths in the application. They are identical for every
 * visitor, change only when an administrator edits the catalog, and are
 * recomputed (with joins and aggregate counts) on every request. A short-lived
 * Redis entry removes the vast majority of that work with a bounded staleness
 * window.
 *
 * SCOPE: this cache is deliberately *optional and additive only*. It must never
 * become a new failure mode of its own, so:
 *
 *   - With no `REDIS_URL` (local development, test, CI) every function is an
 *     immediate no-op: the caller falls through to PostgreSQL exactly as before.
 *   - Every Redis operation is wrapped in a try/catch and a bounded timeout, so
 *     an unavailable or slow Redis degrades to a direct database read instead of
 *     hanging or 500-ing the request. A cache is an optimisation; losing it must
 *     never fail a request.
 *   - Values are namespaced under `vedhicfoods:cache:` so a catalog key can
 *     never collide with the rate-limiter or realtime pub/sub keys sharing the
 *     same Redis instance.
 *
 * Only public, non-PII catalog shapes are cached (see the services). Admin-
 * scoped listings are never written here.
 */

const CACHE_KEY_NAMESPACE = 'vedhicfoods:cache'

/**
 * Bound on a single Redis command. `node-redis` queues commands issued while it
 * is reconnecting and never rejects them, so without this a dead Redis would
 * leave a cached read pending forever. A cache operation that cannot finish
 * quickly is simply abandoned in favour of the database.
 */
const REDIS_COMMAND_TIMEOUT_MS = 500

/**
 * Short TTLs. The values are intentionally conservative: the invalidation below
 * is best-effort (and skipped entirely when Redis is unavailable), so the TTL is
 * the actual upper bound on staleness after an admin edit.
 */
export const CACHE_TTL_SECONDS = {
  productList: 30,
  productDetail: 120,
  categoryList: 120,
  categoryDetail: 120,
} as const

let redisClient: RedisClientType | null = null

/**
 * Test seam. `undefined` means "not injected, use the real client based on
 * env.REDIS_URL"; `null` means "explicitly disabled"; a client means "use this".
 */
let testClient: RedisClientType | null | undefined = undefined

/** True only between a logged cache failure and the next successful command. */
let failureLogged = false

function logCacheFailure(error: unknown): void {
  if (failureLogged) return
  failureLogged = true
  logger.warn(
    { err: error },
    '[cache] Redis cache operation failed; catalog reads are being served directly from PostgreSQL',
  )
}

function clearCacheFailure(): void {
  failureLogged = false
}

function currentClient(): RedisClientType | null {
  if (testClient !== undefined) return testClient
  if (!env.REDIS_URL) return null

  if (!redisClient) {
    redisClient = createClient({ url: env.REDIS_URL })
    // State-transition logging only: the node-redis client emits `error` on
    // every reconnect attempt, so logging each one would flood the log during
    // an outage and bury the signal.
    redisClient.on('error', error => logCacheFailure(error))
    redisClient.connect().then(
      () => clearCacheFailure(),
      error => logCacheFailure(error),
    )
  }

  return redisClient
}

/** Rejects after `REDIS_COMMAND_TIMEOUT_MS`, whichever settles first. */
function withTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Redis cache command timed out after ${REDIS_COMMAND_TIMEOUT_MS}ms`))
    }, REDIS_COMMAND_TIMEOUT_MS)
    timer.unref?.()

    operation.then(
      value => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Builds a fully-qualified cache key from a namespaced suffix. */
export function cacheKey(suffix: string): string {
  return `${CACHE_KEY_NAMESPACE}:${suffix}`
}

/**
 * Reads a JSON value. Returns `null` on a miss *or* any failure — an unavailable
 * cache and an empty cache are indistinguishable to the caller on purpose.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = currentClient()
  if (!client) return null

  try {
    const raw = await withTimeout(client.get(key))
    clearCacheFailure()
    return raw ? (JSON.parse(raw) as T) : null
  } catch (error) {
    logCacheFailure(error)
    return null
  }
}

/** Writes a JSON value with a TTL. Never throws. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = currentClient()
  if (!client) return

  try {
    await withTimeout(client.set(key, JSON.stringify(value), { EX: ttlSeconds }))
    clearCacheFailure()
  } catch (error) {
    logCacheFailure(error)
  }
}

/** Deletes one or more exact keys. Never throws. */
export async function cacheDelete(keys: string | string[]): Promise<void> {
  const client = currentClient()
  if (!client) return

  const list = Array.isArray(keys) ? keys : [keys]
  if (list.length === 0) return

  try {
    await withTimeout(client.del(list))
    clearCacheFailure()
  } catch (error) {
    logCacheFailure(error)
  }
}

/**
 * Deletes every key sharing a prefix.
 *
 * Uses a bounded `SCAN` (never `KEYS`, which blocks the whole Redis instance).
 * The catalogue's key space is small and invalidation runs only on an
 * administrator edit, so a cursor walk is cheap. The iteration count is capped
 * so a pathological key space cannot turn one admin write into an unbounded
 * loop.
 */
export async function cacheDeleteByPrefix(prefix: string): Promise<void> {
  const client = currentClient()
  if (!client) return

  try {
    let cursor = 0
    let iterations = 0

    do {
      const reply = await withTimeout(client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 }))
      cursor = Number(reply.cursor)
      if (reply.keys.length > 0) {
        await withTimeout(client.del(reply.keys))
      }
      iterations += 1
    } while (cursor !== 0 && iterations < 100)

    clearCacheFailure()
  } catch (error) {
    logCacheFailure(error)
  }
}

/**
 * Read-through helper: return the cached value, otherwise run `producer`, cache
 * its result and return it.
 *
 * `producer` errors propagate unchanged (a database failure must still surface);
 * only the cache reads/writes above are swallowed.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key)
  if (cached !== null && cached !== undefined) {
    return cached
  }

  const value = await producer()
  await cacheSet(key, value, ttlSeconds)
  return value
}

/** Test seam: inject a fake client (or `null` to force the disabled path). */
export function __setCacheClientForTests(client: RedisClientType | null): void {
  testClient = client
  failureLogged = false
}

/** Test seam: drop every cached client/state. */
export function __resetCacheForTests(): void {
  testClient = undefined
  if (redisClient) {
    try {
      void redisClient.quit?.()
    } catch {
      // already closed
    }
    redisClient = null
  }
  failureLogged = false
}
