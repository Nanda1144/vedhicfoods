import { db } from 'vedhicfoods-database'
import { logger } from './logger'

/**
 * The platform-wide PrismaClient singleton.
 *
 * The client itself is owned by the `vedhicfoods-database` workspace package so
 * there is exactly one definition of the connection for the whole platform.
 * This module stays as the backend's single import site, and owns the
 * application-level health/lifecycle helpers around it.
 */
export const prisma = db

/**
 * Log the effective pool sizing once at boot. A pool larger than the pooler's
 * fair share is the classic cause of "(EMAXCONNSESSION) max clients reached in
 * session mode ... pool_size: 15" under load, so surface it before it bites.
 */
const poolConfig = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '')
    return {
      host: url.host,
      connectionLimit: url.searchParams.get('connection_limit') ?? 'default',
      poolTimeout: url.searchParams.get('pool_timeout') ?? 'default',
      pooled: url.hostname.includes('pooler'),
    }
  } catch {
    return { host: 'unparseable', connectionLimit: 'unknown', poolTimeout: 'unknown', pooled: false }
  }
})()
logger.info(poolConfig, 'PostgreSQL connection pool configured')

/**
 * The readiness probe calls this on every poll (a few seconds apart), so the
 * outcome is logged only when it *changes*. Logging the success line each time
 * produced an entry every few seconds for the life of the process, which is
 * noise an operator has to page through and which hides the transition that
 * actually matters.
 */
let lastConnectionState: boolean | null = null

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1')
    if (lastConnectionState !== true) {
      lastConnectionState = true
      logger.info('Database connection established successfully')
    }
    return true
  } catch (error: any) {
    // PgBouncer transaction poolers emit 42P05 if prepared statements are cached across connections
    if (error?.message?.includes('prepared statement') || error?.code === '42P05') {
      if (lastConnectionState !== true) {
        lastConnectionState = true
        logger.info('Database connection verified through connection pooler')
      }
      return true
    }
    if (lastConnectionState !== false) {
      lastConnectionState = false
      logger.warn({ err: error?.message }, 'PostgreSQL database currently unreachable')
    }
    return false
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect()
    logger.info('Database connection disconnected cleanly')
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from database')
  }
}