import { randomUUID } from 'crypto'
import { Response } from 'express'
import { RoleName } from '@prisma/client'
import { createClient, type RedisClientType } from 'redis'
import { env } from '../config/env'
import { logger } from '../config/logger'

/**
 * Server-Sent Events (SSE) hub.
 *
 * Provides dependency-free real-time push to the admin console and storefront:
 * services call `publish(channel, payload)` after a state change and every
 * connected client whose subscription allows that channel receives an
 * `event: <channel>` frame with a JSON `data` body.
 *
 * Channels are namespaced (`content.updated`, `order.created`, ...) and a client
 * is granted a channel *prefix* at connect time based on identity:
 *
 *   - staff/admin/owner clients  -> everything, including private order rows
 *   - authenticated customers    -> `content.*` only (order privacy is customer-
 *                                    scoped and deliberately not broad-broadcast)
 *   - guests                     -> `content.*` only
 *
 * HORIZONTAL SCALING: the hub is still in-memory for *delivery*, but when
 * `REDIS_URL` is configured `publish` additionally fans the event out over a
 * fixed Redis pub/sub channel, and every instance subscribes to it. A client
 * connected to instance B therefore receives an event published on instance A.
 * The design is deliberately additive:
 *
 *   - With no `REDIS_URL` (local development, test, CI) this module is exactly
 *     the original in-memory hub: same behaviour, no network, no socket.
 *   - Local delivery happens synchronously in `publish`, so a client connected
 *     to the *origin* instance is served even when Redis is down, and the
 *     message still returns through the subscriber (node-redis replays what the
 *     same instance published). The message carries the origin's instance id
 *     and the subscriber drops its own messages, so every client sees an event
 *     exactly once and there are no rebroadcast loops.
 *   - Redis failures are bounded and logged: `publish` never throws and never
 *     blocks on the network; cross-instance delivery degrades to local-only and
 *     the process keeps serving.
 */
export type EventChannel = string

export interface RealtimeClient {
  res: Response
  allowedPrefixes: string[]
  userId?: string | null
  closed: boolean
}

const HEARTBEAT_INTERVAL_MS = 25_000

/**
 * Fixed pub/sub channel. Namespaced so it cannot collide with the rate limiter
 * (`rl:*`) or catalogue cache (`vedhicfoods:cache:*`) keys on a shared Redis.
 */
const REALTIME_CHANNEL = 'vedhicfoods:realtime'

/** Test seam: overrides the real `createClient` factory. */
let redisFactoryForTests: ((url: string) => RedisClientType) | null = null

class RealtimeHub {
  private clients = new Set<RealtimeClient>()
  private sequence = 0
  private heartbeatTimer: NodeJS.Timeout | null = null

  /**
   * Identifies this process on the pub/sub channel. Messages published here are
   * also delivered to this instance's subscriber, so the origin id is what lets
   * the subscriber distinguish "already delivered locally" from "published by a
   * sibling instance".
   */
  private readonly instanceId = randomUUID()

  private redisSubscriber: RedisClientType | null = null
  private redisPublisher: RedisClientType | null = null
  /** Resolves once the Redis clients are connected, or `false` if they are not. */
  private redisInit: Promise<boolean> | null = null
  /** Serialises Redis publishes, including the pending connection attempt. */
  private redisChain: Promise<void> = Promise.resolve()
  /** True only between a logged Redis outage and the next successful publish. */
  private redisOutage = false

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        try {
          // A comment frame doubles as the SSE keep-alive; proxies terminate
          // idle connections unless they see bytes within their idle timeout.
          client.res.write(': ping\n\n')
        } catch {
          client.closed = true
          this.clients.delete(client)
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
    // Do not keep the Node process alive purely for connected browsers.
    this.heartbeatTimer.unref?.()
  }

  /**
   * Connects the pub/sub client pair exactly once.
   *
   * Never rejects: a failure resolves to `false` so the caller degrades to
   * local-only delivery instead of surfacing an exception on the request path.
   */
  private async connectRedis(): Promise<boolean> {
    if (!env.REDIS_URL) return false

    let subscriber: RedisClientType | null = null
    let publisher: RedisClientType | null = null

    try {
      const factory = redisFactoryForTests ?? ((url: string) => createClient({ url }))
      // node-redis requires a connection to be in subscriber mode to consume
      // messages, and in normal mode to publish. A client cannot do both, so
      // two connections are opened — the same shape the rate limiter uses.
      subscriber = factory(env.REDIS_URL)
      publisher = factory(env.REDIS_URL)
      subscriber.on('error', error => this.onRedisError(error))
      publisher.on('error', error => this.onRedisError(error))

      await subscriber.connect()
      await publisher.connect()
      await subscriber.subscribe(REALTIME_CHANNEL, message => this.handleRedisMessage(message))

      this.redisSubscriber = subscriber
      this.redisPublisher = publisher
      this.redisOutage = false
      logger.info({ channel: REALTIME_CHANNEL }, '[realtime] Redis pub/sub fan-out enabled')
      return true
    } catch (error) {
      logger.warn(
        { err: error },
        '[realtime] Redis pub/sub unavailable; realtime events will be delivered to this instance only',
      )
      // Best-effort cleanup of a half-open connection attempt.
      for (const client of [subscriber, publisher]) {
        try {
          await client?.quit?.()
        } catch {
          // already closed
        }
      }
      return false
    }
  }

  private ensureRedis(): Promise<boolean> {
    if (!env.REDIS_URL) return Promise.resolve(false)
    if (!this.redisInit) {
      this.redisInit = this.connectRedis()
    }
    return this.redisInit
  }

  /** State-transition logging only; the client emits `error` on every retry. */
  private onRedisError(error: unknown): void {
    if (this.redisOutage) return
    this.redisOutage = true
    logger.warn(
      { err: error },
      '[realtime] Redis pub/sub connection error; cross-instance delivery is degraded',
    )
  }

  /**
   * Queues the event for the Redis fan-out.
   *
   * Delivery is best-effort and never awaited by the caller: the queue is
   * chained so ordering is preserved, and every failure is swallowed after being
   * logged once. A `publish` therefore cannot throw or block on the network.
   */
  private enqueueRedisPublish(channel: string, data: string): void {
    if (!env.REDIS_URL) return

    this.redisChain = this.redisChain
      .then(async () => {
        const ready = await this.ensureRedis()
        if (!ready || !this.redisPublisher) return

        await this.redisPublisher.publish(
          REALTIME_CHANNEL,
          JSON.stringify({ origin: this.instanceId, channel, data }),
        )
        this.redisOutage = false
      })
      .catch(error => this.onRedisError(error))
  }

  /**
   * Registers a response for real-time broadcast and returns the disconnect fn.
   * Must be called after headers have been written for `text/event-stream`.
   */
  subscribe(res: Response, identity: { userId?: string | null; roles?: RoleName[] } = {}): () => void {
    const staffRoles: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF]
    const isStaffConsole = (identity.roles ?? []).some((role) => staffRoles.includes(role))
    const allowedPrefixes = isStaffConsole ? ['order.', 'notification.', 'content.', 'settings.', 'subscriber.'] : ['content.']

    const client: RealtimeClient = {
      res,
      allowedPrefixes,
      userId: identity.userId ?? null,
      closed: false,
    }
    this.clients.add(client)
    this.ensureHeartbeat()

    // Connection is lazy but triggered as soon as the first client attaches, so
    // a running server always has its subscriber in place before traffic.
    void this.ensureRedis()

    const detach = (cause: string) => {
      client.closed = true
      this.clients.delete(client)
      try {
        res.end()
      } catch {
        // already closed on the wire
      }
      logger.debug({ cause, connected: this.clients.size }, 'Realtime client disconnected')
    }

    res.on('close', () => detach('close'))
    res.on('error', () => detach('error'))

    return () => detach('manual')
  }

  /** How many browser connections are currently listening. */
  get connectedClients(): number {
    return this.clients.size
  }

  /**
   * Writes an already-serialized frame to the *local* clients that subscribe to
   * `channel`. This is the single delivery primitive used by both the local
   * publish path and the Redis subscriber, guaranteeing identical filtering.
   */
  private deliverLocal(channel: string, data: string): void {
    this.sequence += 1
    const id = String(this.sequence)

    for (const client of this.clients) {
      if (client.closed) {
        this.clients.delete(client)
        continue
      }
      if (!client.allowedPrefixes.some((allowed) => channel.startsWith(allowed))) continue
      try {
        // A channel with `:` is frame-invalid; guards against misuse by keeping
        // event names to `namespace.subject` form only.
        const eventName = channel.includes(':') ? 'message' : channel
        client.res.write(`id: ${id}\nevent: ${eventName}\ndata: ${data}\n\n`)
      } catch {
        client.closed = true
        this.clients.delete(client)
      }
    }
  }

  publish(channel: string, payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null)

    // Local delivery first and synchronously: it must work regardless of Redis,
    // and it is what makes the origin instance's clients see the event exactly
    // once (the subscriber skips messages bearing this instance id).
    this.deliverLocal(channel, data)

    // Fan out to sibling instances. Fire-and-forget; never throws.
    this.enqueueRedisPublish(channel, data)
  }

  /** Handles a message received from a sibling instance (or our own echo). */
  private handleRedisMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as { origin?: string; channel?: string; data?: unknown }
      if (!parsed || typeof parsed.channel !== 'string') return

      // Our own publish already delivered locally; ignore the echo so the event
      // is not duplicated and is never re-published (no loop).
      if (parsed.origin === this.instanceId) return

      const data = typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data ?? null)
      this.deliverLocal(parsed.channel, data)
    } catch (error) {
      logger.warn({ err: error }, '[realtime] Ignoring malformed Redis pub/sub message')
    }
  }

  /** Drops every connection — used during shutdown tests / graceful stop. */
  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.res.end()
      } catch {
        // already closed
      }
    }
    this.clients.clear()
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Graceful shutdown: drop browser connections, drain the publish queue and
   * close both Redis connections. Safe to call when Redis was never configured.
   */
  async close(): Promise<void> {
    this.closeAll()

    try {
      await this.redisInit
    } catch {
      // connectRedis never rejects, but be defensive.
    }
    try {
      await this.redisChain
    } catch {
      // enqueueRedisPublish already swallows failures.
    }

    for (const client of [this.redisSubscriber, this.redisPublisher]) {
      if (!client) continue
      try {
        await client.quit()
      } catch {
        // already closed
      }
    }

    this.redisSubscriber = null
    this.redisPublisher = null
    this.redisInit = null
    this.redisChain = Promise.resolve()
  }

  /** Test seam: resolves once the connection is settled and every queued Redis publish has drained. */
  async __flushForTests(): Promise<void> {
    await this.ensureRedis()
    await this.redisChain
  }
}

/** Process-wide singleton backing both the `/events` route and `publish` calls. */
export const realtime = new RealtimeHub()

/** Convenience wrapper matching the Redis fan-out surface this now provides. */
export function publish(channel: string, payload: unknown): void {
  realtime.publish(channel, payload)
}

/** Graceful-shutdown hook: drains and closes the realtime Redis connections. */
export function closeRealtime(): Promise<void> {
  return realtime.close()
}

/** Test seam: inject a fake `createClient` factory. Pass `null` to restore. */
export function __setRealtimeRedisFactoryForTests(
  factory: ((url: string) => RedisClientType) | null,
): void {
  redisFactoryForTests = factory
}

/** Test seam: reset the hub and its Redis state between suites. */
export async function __resetRealtimeForTests(): Promise<void> {
  redisFactoryForTests = null
  await realtime.close()
}
