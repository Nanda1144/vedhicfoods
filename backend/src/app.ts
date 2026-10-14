import express, { Express } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import { env, resolveTrustProxy } from './config/env'
import { requestIdMiddleware } from './middleware/request-id.middleware'
import { httpLoggerMiddleware } from './middleware/logging.middleware'
import { apiRateLimiter } from './middleware/rate-limiter.middleware'
import { errorHandlerMiddleware } from './middleware/error.middleware'
import { notFoundMiddleware } from './middleware/not-found.middleware'
import { captureRawBody } from './utils/raw-body'
import { apiV1Router } from './routes'

/**
 * Builds the set of browser origins permitted to call the API.
 *
 * SECURITY: the previous implementation short-circuited to "allow everything"
 * whenever NODE_ENV was `development`:
 *
 *   if (allowedOrigins.includes(origin) || env.NODE_ENV === 'development')
 *
 * A misconfigured production deploy (NODE_ENV unset or `development`, which is
 * the schema default) therefore handed every website on the internet
 * credentialed cross-origin access to the API. Origin enforcement is now
 * unconditional; development convenience comes from the explicit localhost
 * entries below rather than from a wildcard bypass.
 *
 * Exported so `server.ts` can log the resolved allowlist at boot. CORS is
 * otherwise invisible until it fails, and a wrong origin in production presents to
 * the customer as an unexplained empty response with nothing in either console.
 */
export function buildAllowedOrigins(): string[] {
  const configured = [env.FRONTEND_URL, env.ADMIN_FRONTEND_URL]

  const origins = new Set<string>()

  for (const origin of configured) {
    const trimmed = String(origin || '').trim().replace(/\/$/, '')
    if (!trimmed || trimmed === '*') continue
    origins.add(trimmed)
  }

  if (env.NODE_ENV !== 'production') {
    // Local Vite dev servers for the storefront and the admin portal.
    origins.add('http://localhost:5173')
    origins.add('http://localhost:5174')
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://127.0.0.1:5174')
  }

  return Array.from(origins)
}

export function createApp(): Express {
  const app = express()

  // 1. Trust Reverse Proxy (AWS ALB / CloudFront)
  //
  // SECURITY: this was hardcoded to `1`. Express then treats the leftmost
  // `X-Forwarded-For` entry as the client address, and that value is what
  // `express-rate-limit` keys on. The assumption — "there is exactly one
  // well-behaved proxy in front of us" — is not something the app can verify:
  // whenever it did not hold (a directly exposed container, a second hop, a
  // miswired target group) the header was fully attacker-controlled, so one
  // varying header per request defeated the login, password-reset, contact-form
  // and guest-checkout limits, and poisoned the IP address stored against audit
  // entries and refresh tokens.
  //
  // It is now configuration, defaults to `false`, and production refuses to boot
  // without it so the topology is stated rather than assumed.
  app.set('trust proxy', resolveTrustProxy(env.TRUST_PROXY))

  // 2. Security Headers (Helmet)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          ...(env.NODE_ENV === 'production'
            ? {}
            : {
                // Vite dev servers inject inline/eval'd module scripts.
                'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
              }),
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': env.NODE_ENV === 'production' ? [] : null,
        },
      },
      // Enforce TLS on every response once the app is behind an ALB/CloudFront.
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      crossOriginEmbedderPolicy: false,
      // Do not let a CDN serve a stale/incorrect MIME interpretation of API output.
      noSniff: true,
      referrerPolicy: { policy: 'no-referrer' },
    })
  )

  // 3. Environment-based CORS Configuration
  const allowedOrigins = buildAllowedOrigins()

  app.use(
    cors({
      origin: (origin, callback) => {
        // Requests with no Origin header are same-origin navigations, native
        // mobile clients, and server-to-server calls. These are not subject to
        // the browser's cross-origin model, so they are permitted — auth is
        // still enforced by the route guards.
        if (!origin) return callback(null, true)

        if (allowedOrigins.includes(origin)) {
          return callback(null, true)
        }

        // Deny silently rather than throwing: throwing surfaces the allowed
        // origin list through the error handler and teaches an attacker which
        // origins are valid.
        return callback(null, false)
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Request-ID',
        'Idempotency-Key',
        // Guest cart identity: set by the storefront on every cart request
        // (`x-session-token`). Omitting it fails the browser preflight, so the
        // storefront cannot add to / read the cart at all.
        'X-Session-Token',
      ],
      exposedHeaders: ['X-Request-ID', 'RateLimit', 'RateLimit-Policy', 'X-Idempotent-Replay'],
      maxAge: 600,
      optionsSuccessStatus: 204,
    })
  )

  // 4. Request ID Tracing & Logging
  app.use(requestIdMiddleware)
  if (env.NODE_ENV !== 'test') {
    app.use(httpLoggerMiddleware)
  }

  // 5. Body Parsers & Compression
  app.use(compression())
  // NOTE: the `verify` hook captures the byte-exact body for signed webhooks.
  // A route-level `express.raw()` cannot do this because this parser runs first
  // and consumes the request stream before the router is reached.
  app.use(
    express.json({
      limit: '1mb',
      verify: captureRawBody,
    })
  )
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  // 6. Global Rate Limiter
  app.use('/api', apiRateLimiter)

  // 7. Mount Versioned REST API
  app.use('/api/v1', apiV1Router)

  // 8. 404 & Centralized Error Handlers
  app.use(notFoundMiddleware)
  app.use(errorHandlerMiddleware)

  return app
}
