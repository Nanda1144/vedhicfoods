import { checkDatabaseConnection } from '../config/database'
import { env } from '../config/env'
import { rateLimitStoreHealth } from '../middleware/rate-limiter.middleware'

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  service: string
  environment: string
  timestamp: string
  uptimeSeconds: number
}

export interface ReadinessStatus extends HealthStatus {
  checks: {
    database: 'connected' | 'disconnected'
    rateLimiter: 'in-process' | 'connected' | 'disconnected'
  }
}

export class HealthService {
  public static getLiveness(): HealthStatus {
    return {
      status: 'healthy',
      service: 'vedhicfoods-backend',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    }
  }

  /**
   * Readiness drives load-balancer membership, so only the database can make
   * the instance `unhealthy` — without it no request can be served at all.
   *
   * A missing shared rate-limit store degrades the instance instead: every
   * non-health request fails closed with 503, which is a real impairment worth
   * reporting, but pulling the instance from rotation would turn one broken
   * dependency into an outage across the whole fleet. `degraded` is therefore
   * informational and still answers 200 (see HealthController).
   */
  public static async getReadiness(): Promise<ReadinessStatus> {
    const isDbConnected = await checkDatabaseConnection()
    const rateLimiter = rateLimitStoreHealth()

    let status: ReadinessStatus['status'] = 'healthy'
    if (!isDbConnected) {
      status = 'unhealthy'
    } else if (rateLimiter === 'disconnected') {
      status = 'degraded'
    }

    return {
      status,
      service: 'vedhicfoods-backend',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        database: isDbConnected ? 'connected' : 'disconnected',
        rateLimiter,
      },
    }
  }
}
