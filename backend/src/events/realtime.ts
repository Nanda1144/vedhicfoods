import { Response } from 'express'
import { RoleName } from '@prisma/client'
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
 * This is intentionally in-memory: broadcasts work across all connections to
 * this process, which matches the current single-instance deployment. A
 * horizontally-scaling deployment must swap this for a Redis pub/sub fan-out
 * (the backend already ships `redis`) behind the same `publish` interface.
 */
export type EventChannel = string

export interface RealtimeClient {
  res: Response
  allowedPrefixes: string[]
  userId?: string | null
  closed: boolean
}

const HEARTBEAT_INTERVAL_MS = 25_000

class RealtimeHub {
  private clients = new Set<RealtimeClient>()
  private sequence = 0
  private heartbeatTimer: NodeJS.Timeout | null = null

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

  publish(channel: string, payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null)
    this.sequence += 1
    const id = String(this.sequence)

    const prefix = channel.split('.')[0]
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
}

/** Process-wide singleton backing both the `/events` route and `publish` calls. */
export const realtime = new RealtimeHub()

/** Convenience wrapper matching the Redis fan-out surface this will replace. */
export function publish(channel: string, payload: unknown): void {
  realtime.publish(channel, payload)
}