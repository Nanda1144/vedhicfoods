import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { RoleName } from '@prisma/client'
import { env } from '../config/env'
import { realtime } from '../events/realtime'
import { AuthService } from '../services/auth.service'
import { logger } from '../config/logger'

/**
 * GET /api/v1/events
 *
 * Server-Sent Events stream. `EventSource` cannot set an Authorization header,
 * so unlike every other endpoint this route also accepts the access token in a
 * `?token=` query parameter. The token is never logged and lives only in the
 * memory of the client and this request handler.
 *
 * Channel access is identity-derived (see `events/realtime.ts`): staff/admin
 * clients receive order/notification events plus content/subscriber broadcasts;
 * guests and customers receive only the public `content.*` stream.
 */
export const eventRoutes = Router()

eventRoutes.get('/', async (req, res) => {
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : undefined
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined
  const token = headerToken || queryToken

  let roles: RoleName[] = []
  let userId: string | null = null

  if (token && token.length <= 4096 && /^[A-Za-z0-9._-]+$/.test(token)) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as any
      if (decoded?.userId && decoded?.tokenType === 'access') {
        const resolved = await AuthService.resolveUserPermissions(decoded.userId)
        if (resolved.exists && resolved.isActive && !resolved.isDeleted) {
          userId = decoded.userId
          roles = resolved.roles
        }
      }
    } catch {
      // An expired/invalid token yields an anonymous stream, matching optionalAuth.
      // The admin client reconnects with the refreshed token after a re-login.
    }
  }

  // SSE handshake: flush buffered content immediately so the browser fires
  // `onopen`, then keep the connection alive until the client disconnects.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')

  logger.info({ userId, roles: roles.length > 0 }, 'Realtime client connected')
  const detach = realtime.subscribe(res, { userId, roles })

  // Clean up when the client's TCP connection drops (surrogate for the browser
  // unregistering the EventSource).
  const onClose = () => detach()
  req.on('close', onClose)
})