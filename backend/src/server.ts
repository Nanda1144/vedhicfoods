import http from 'http'
import { createApp, buildAllowedOrigins } from './app'
import { env, loadedEnvFiles } from './config/env'
import { logger } from './config/logger'
import { checkDatabaseConnection, disconnectDatabase } from './config/database'

async function bootstrap(): Promise<void> {
  // Names only, never contents. This is what answers "which environment's
  // variables did this task actually pick up?" when a production deploy behaves
  // like staging. Expect `[]` on ECS/EC2, where the task definition supplies
  // everything through the real environment.
  logger.info(
    { environment: env.NODE_ENV, envFiles: loadedEnvFiles },
    'Starting Vedhic Foods backend service...'
  )

  // 1. Check Database Connectivity
  const isDbReady = await checkDatabaseConnection()
  if (!isDbReady && env.NODE_ENV === 'production') {
    logger.fatal('Cannot start production service without active PostgreSQL database connection.')
    process.exit(1)
  }

  // 2. Initialize Express application
  const app = createApp()
  const server = http.createServer(app)

  // 3. Server timeouts.
  //
  // Without these, a slow or stalled client can hold a socket open indefinitely.
  // Under load that exhausts the instance's file descriptors, and because
  // Node's HTTP agent keeps sockets alive by default, the instance stops
  // accepting new work while appearing healthy to the load balancer.
  //
  // `requestTimeout` is the hard ceiling on a single request; it must sit above
  // the slowest legitimate operation (invoice PDF generation + S3 upload) and
  // below the load balancer's idle timeout, otherwise the proxy drops the
  // connection while the app is still working on it.
  server.requestTimeout = env.REQUEST_TIMEOUT_MS
  server.headersTimeout = env.HEADERS_TIMEOUT_MS
  // Keep-alive slightly under a typical 60s ALB idle timeout so the *server*
  // closes idle sockets first and never races the proxy into a 502.
  server.keepAliveTimeout = env.KEEP_ALIVE_TIMEOUT_MS
  server.maxHeadersCount = 100

  // 4. Start listening on configured port
  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        environment: env.NODE_ENV,
        requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
        keepAliveTimeoutMs: env.KEEP_ALIVE_TIMEOUT_MS,
        trustProxy: env.TRUST_PROXY,
        allowedOrigins: buildAllowedOrigins(),
        healthEndpoint: `http://localhost:${env.PORT}/api/v1/health`,
      },
      `🚀 Vedhic Foods Backend running on port ${env.PORT}`
    )
  })

  // 5. Graceful Shutdown Handler
  //
  // MULTI-INSTANCE: during a rolling deploy the load balancer starts sending
  // traffic to the *new* task only once the old one reports unhealthy, but
  // connections already established to the old task must still be allowed to
  // finish. `server.close()` alone stops new connections while waiting for
  // existing ones — including idle keep-alive sockets that may never send
  // another byte. That wait is what made deploys fall through to the 10s
  // forced exit, dropping in-flight checkouts. Idle sockets are therefore
  // closed explicitly and only *active* requests are given the grace window.
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true

    logger.info({ signal }, `Received ${signal}. Commencing graceful shutdown...`)

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded. Forcing process exit.')
      server.closeAllConnections?.()
      process.exit(1)
    }, env.SHUTDOWN_GRACE_MS)
    forceExit.unref()

    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'Error closing HTTP server')
        process.exit(1)
      }

      logger.info('HTTP server closed successfully. Disconnecting database...')
      await disconnectDatabase()

      logger.info('Graceful shutdown completed successfully. Exiting process.')
      process.exit(0)
    })

    // Node 18+: drop sockets that are between requests right away so they do not
    // hold the close above open. Requests already being served keep running.
    server.closeIdleConnections?.()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise Rejection detected')
  })

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught Exception detected')
    process.exit(1)
  })
}

bootstrap()
