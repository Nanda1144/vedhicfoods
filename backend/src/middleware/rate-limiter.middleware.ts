import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { createClient, type RedisClientType } from 'redis'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { ServiceUnavailableError } from '../utils/errors'

/**
 * Shared rate-limit store.
 *
 * MULTI-INSTANCE SECURITY: `express-rate-limit`'s default store is an in-process
 * `Map`. Behind a load balancer with N instances, each instance keeps its own
 * counters, so the *effective* limit is `configured limit x N`. The limits below
 * are the only thing standing between a credential-stuffing run and a breached
 * admin account, so silently multiplying them by the replica count defeats the
 * control exactly when it matters most — on a busy production deployment.
 *
 * A single Redis instance is therefore used for all limiters when `REDIS_URL` is
 * configured, which makes the counters global across every instance.
 *
 * FAIL-CLOSED: if `REDIS_URL` is absent in production the app refuses to boot
 * rather than quietly running with per-instance limits. In development and test
 * the in-memory store is used, which is correct because there is only one
 * process.
 *
 * AVAILABILITY: once a client *is* configured, every Redis command is bounded by
 * `REDIS_COMMAND_TIMEOUT_MS`. The node-redis client queues commands issued
 * while it is reconnecting and never rejects them, so an unreachable Redis used
 * to leave `store.increment()` pending forever — every request to `/api/*`
 * (health checks included) hung until `server.requestTimeout` tore the socket
 * down, and the LB health probe failed with it. A timed-out command now rejects
 * with `ServiceUnavailableError`, which the central handler answers as a 503:
 * the caller gets an immediate, correct response instead of a stalled one.
 *
 * `express-rate-limit` v7 validates that a custom store does not silently no-op;
 * if the Redis connection is lost the limiter fails closed (requests are
 * rejected) rather than reverting to unlimited.
 */

const REDIS_COMMAND_TIMEOUT_MS = 1_000

let redisClient: RedisClientType | null = null

export type RateLimitStoreHealth = 'in-process' | 'connected' | 'disconnected'

let storeHealth: RateLimitStoreHealth = 'in-process'

/** True only between a logged outage and its logged recovery. */
let outageLogged = false

/**
 * Observes state *transitions* only.
 *
 * The Redis client emits `error` on every reconnect attempt (roughly twice a
 * second under the default backoff), so logging each one turned a Redis outage
 * into an unbounded log flood that buried the very errors an operator needs.
 * One entry per outage and one on recovery carry the same signal at a
 * fraction of the cost.
 */
function markStoreUnavailable(reason: unknown): void {
  if (storeHealth === 'disconnected') return
  storeHealth = 'disconnected'
  outageLogged = true
  logger.error(
    { err: reason },
    '[rate-limit] Redis store unavailable; requests now fail closed with 503 until it recovers'
  )
}

function markStoreAvailable(): void {
  const wasDown = storeHealth === 'disconnected'
  storeHealth = 'connected'
  if (wasDown && outageLogged) {
    outageLogged = false
    logger.info('[rate-limit] Redis store recovered; distributed rate limiting resumed')
  }
}

/** Reported by the readiness probe so an operator can see the degradation. */
export function rateLimitStoreHealth(): RateLimitStoreHealth {
  return storeHealth
}

/**
 * Wraps `sendCommand` so it can never outlive `REDIS_COMMAND_TIMEOUT_MS`.
 *
 * Both outcomes are normalised to `ServiceUnavailableError`: an infrastructure
 * failure must not be able to reach the error handler as an arbitrary error
 * type, or it is logged with a stack trace and returned as a 500 for every
 * request for the duration of the outage.
 */
function sendCommand(args: string[]): Promise<any> {
  const client = redisClient
  if (!client) {
    return Promise.reject(new ServiceUnavailableError())
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      markStoreUnavailable(new Error(`Redis command timed out after ${REDIS_COMMAND_TIMEOUT_MS}ms`))
      reject(new ServiceUnavailableError())
    }, REDIS_COMMAND_TIMEOUT_MS)
    timer.unref?.()

    // `sendCommand` can throw synchronously (client closed / not yet open), so
    // the call itself is guarded: an exception here would otherwise reject the
    // outer promise with the raw driver error and reach the handler untyped.
    try {
      Promise.resolve(client.sendCommand(args)).then(
        value => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          markStoreAvailable()
          resolve(value)
        },
        error => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          markStoreUnavailable(error)
          reject(new ServiceUnavailableError())
        }
      )
    } catch (error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      markStoreUnavailable(error)
      reject(new ServiceUnavailableError())
    }
  })
}

type LimiterConfig = NonNullable<Parameters<typeof rateLimit>[0]>

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Promise<unknown>).then === 'function'
  )
}

/**
 * `rate-limit-redis` stores the Lua script SHAs in `incrementScriptSha` and
 * `getScriptSha` as promises. It assigns them without awaiting (in the
 * constructor and again whenever an `EVALSHA` fails) and only reads them back
 * on the *next* command. If the command rejects — which is exactly what the
 * bounded timeout above guarantees during a Redis outage — the freshly spawned
 * load promise is never awaited by anyone, so it rejects unobserved.
 *
 * The production process survives that (server.ts installs an
 * `unhandledRejection` listener), but it emits one serialized stack trace per
 * request, which is the same log-flood problem as the client error events.
 * Redefining the two fields with a setter that attaches a no-op catch keeps the
 * rejection available to the library's own `await` while marking it handled for
 * Node's unhandled-rejection check.
 */
const SCRIPT_SHA_FIELDS = ['incrementScriptSha', 'getScriptSha'] as const

class GuardedRedisStore extends RedisStore {
  constructor(options: ConstructorParameters<typeof RedisStore>[0]) {
    super(options)

    const self = this as unknown as Record<string, unknown>

    for (const field of SCRIPT_SHA_FIELDS) {
      const initial = self[field]
      if (isThenable(initial)) {
        initial.catch(() => undefined)
      }

      let current: unknown = initial

      Object.defineProperty(this, field, {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (value: unknown) => {
          if (isThenable(value)) {
            value.catch(() => undefined)
          }
          current = value
        },
      })
    }
  }
}

function buildStore(namespace: string): LimiterConfig['store'] {
  if (!env.REDIS_URL) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        '[rate-limit] REDIS_URL is required in production.\n' +
          'The default express-rate-limit store is per-process, so with more than one\n' +
          'instance the effective limit is multiplied by the number of replicas.\n' +
          'Set REDIS_URL (or run a single instance) rather than accepting that.',
      )
    }

    logger.warn(
      { namespace },
      '[rate-limit] REDIS_URL not set; using the in-process store. Limits are per-instance. ' +
        'This is fine for local development only.',
    )
    storeHealth = 'in-process'
    return undefined
  }

  if (!redisClient) {
    // Reported as down until the connection attempt succeeds: a readiness probe
    // arriving in that window should not claim distributed limits are active.
    storeHealth = 'disconnected'
    redisClient = createClient({ url: env.REDIS_URL })
    // State-transition logging only: this event fires on every failed retry.
    redisClient.on('error', error => markStoreUnavailable(error))
    redisClient.connect().then(
      () => markStoreAvailable(),
      error => markStoreUnavailable(error),
    )
  }

  return new GuardedRedisStore({
    sendCommand: (...args: string[]) => sendCommand(args),
    prefix: `rl:${namespace}:`,
  })
}

/**
 * Applies the shared store to a limiter definition.
 *
 * Every limiter must go through this. Adding a new `rateLimit({...})` without
 * `withSharedStore` would reintroduce per-instance counting, so the wrapper is
 * the only exported way to build a limiter here.
 */
export function withSharedStore(namespace: string, options: LimiterConfig): RateLimitRequestHandler {
  return rateLimit({
    ...options,
    store: buildStore(namespace),
  })
}

/** Test seam: drops the cached client so a suite can point at another Redis. */
export function __resetRateLimitStoreForTests(): void {
  redisClient = null
}

/**
 * Health probes are deliberately exempt from the global limiter.
 *
 * `/api/v1/health` and `/api/v1/health/ready` are what the load balancer and
 * the orchestrator poll; they are unauthenticated, side-effect free and cheap.
 * Charging them against the shared budget means a limiter outage (which fails
 * those requests closed with 503) or a burst of ordinary API traffic can make
 * the probe fail and pull an otherwise healthy instance out of rotation —
 * converting a degraded dependency into a full outage.
 */
const HEALTH_PROBE_PATHS = new Set(['/api/v1/health', '/api/v1/health/ready'])

export const apiRateLimiter = withSharedStore('api', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Ceiling for the whole `/api` surface, keyed per IP.
  //
  // Raised from 200 to 1000: a single admin console session is chatty (the
  // dashboard fans out to a dozen endpoints, and the SPA polls/streams in the
  // background), so 200/15min let ordinary use exhaust the shared per-IP budget
  // and then 429'd *every* API call — admin and storefront alike — for a full
  // 15 minutes. Worse, several staff behind one office NAT share a single key.
  // 1000 keeps a meaningful abuse guard while giving real usage headroom.
  max: env.NODE_ENV === 'test' ? 10000 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => {
    const path = (req.originalUrl || req.url || '').split('?')[0]
    return HEALTH_PROBE_PATHS.has(path)
  },
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after 15 minutes.',
  },
})

export const authRateLimiter = withSharedStore('auth', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'test' ? 10000 : 20, // 20 login/register attempts per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
})

export const passwordResetRateLimiter = withSharedStore('password-reset', {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: env.NODE_ENV === 'test' ? 10000 : 5, // 5 password reset requests per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many password reset requests. Please try again after 1 hour.',
  },
})

/**
 * Guest storefront checkout (`POST /api/v1/orders` and `/orders/checkout`).
 *
 * This is the only unauthenticated endpoint that writes to the database: it
 * creates the customer row and dispatches a Brevo invoice email to the
 * address supplied in the body. Without a dedicated budget an attacker can mint
 * orders and use the mail quota as a spam relay, so it is capped tightly.
 */
export const checkoutRateLimiter = withSharedStore('checkout', {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: env.NODE_ENV === 'test' ? 10000 : 10, // 10 guest checkouts per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many checkout attempts from this address. Please try again later.',
  },
})

/**
 * Password reset token redemption. Kept separate from the request limiter so a
 * burst of reset *requests* cannot be used to block a user redeeming a token
 * they legitimately received.
 */
export const passwordResetVerifyRateLimiter = withSharedStore('password-reset-verify', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'test' ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many password reset attempts. Please try again in 15 minutes.',
  },
})

/**
 * Email verification token redemption.
 */
export const emailVerificationRateLimiter = withSharedStore('email-verification', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'test' ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many verification attempts. Please try again in 15 minutes.',
  },
})

/**
 * Public contact form. Deliberately stricter than the global limiter: the
 * endpoint is unauthenticated and is the most attractive target for spam
 * floods, so it gets its own tight budget independent of general API traffic.
 */
export const contactRateLimiter = withSharedStore('contact', {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: env.NODE_ENV === 'test' ? 10000 : 5, // 5 contact submissions per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many contact submissions from this address. Please try again later.',
  },
})

/**
 * Public newsletter subscription. Like the contact form, this is unauthenticated
 * and exposed to automated spam, so it carries its own tight per-IP budget.
 */
export const newsletterRateLimiter = withSharedStore('newsletter', {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: env.NODE_ENV === 'test' ? 10000 : 10, // 10 subscriptions per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many subscription attempts from this address. Please try again later.',
  },
})

/**
 * Support ticket creation. Authenticated customers get a higher ceiling than the
 * public contact form but it is still bounded so a compromised session cannot
 * flood the staff inbox.
 */
export const ticketCreateRateLimiter = withSharedStore('ticket-create', {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: env.NODE_ENV === 'test' ? 10000 : 10, // 10 tickets per user per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many support tickets created. Please wait before opening another.',
  },
})

/**
 * Ticket replies. Prevents a single conversation being used to generate
 * outbound email at volume.
 */
export const ticketReplyRateLimiter = withSharedStore('ticket-reply', {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: env.NODE_ENV === 'test' ? 10000 : 20, // 20 replies per user per 10 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many replies sent. Please slow down.',
  },
})