import { Request } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { getClientIp } from '../utils/client-ip'

export interface RecordAuditParams {
  actorId?: string | null
  actorEmail?: string | null
  action: string
  entity: string
  entityId?: string | null
  metadata?: Record<string, any>
  req?: Request
  requestId?: string | null
  /**
   * When set, the audit row is written on the caller's transaction instead of
   * the global pool. Writing on the global pool from inside a transaction
   * borrows a *second* connection while the first is still held — under a small
   * connection limit that starves concurrent requests and the audit write
   * (which merely waits) delays the transaction while it holds row locks.
   */
  tx?: Prisma.TransactionClient
}

export class AuditService {
  /**
   * Sanitizes sensitive fields before persisting to audit trail.
   */
  private static sanitizePayload(data?: Record<string, any>): Record<string, any> {
    if (!data) return {}

    const isSensitiveKey = (key: string): boolean => {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
      return [
        'password',
        'passwd',
        'secret',
        'token',
        'credential',
        'apikey',
        'accesskey',
        'privatekey',
        'authorization',
        'cookie',
      ].some((fragment) => normalized.includes(fragment))
    }

    const visit = (value: any): any => {
      if (Array.isArray(value)) return value.map(visit)
      if (value === null || typeof value !== 'object') return value

      const clean: Record<string, any> = {}
      for (const [key, nested] of Object.entries(value)) {
        clean[key] = isSensitiveKey(key) ? '[REDACTED]' : visit(nested)
      }
      return clean
    }

    return visit(data)
  }

  /**
   * Records a security or administrative audit log.
   */
  public static async record(params: RecordAuditParams): Promise<void> {
    try {
// SECURITY: previously `x-forwarded-for.split(',')[0]`, i.e. the client-supplied
      // leftmost entry rather than the furthest-right untrusted hop. Audit
      // attribution is worthless — and actively misleading during an incident —
      // if the recorded address is chosen by whoever made the request.
      const ipAddress = params.req ? getClientIp(params.req) : null

      const userAgent = params.req ? (params.req.headers['user-agent'] as string) || null : null

      const sanitizedMetadata = this.sanitizePayload(params.metadata)

      await (params.tx ?? prisma).auditLog.create({
        data: {
          actorId: params.actorId || params.req?.user?.id || null,
          actorEmail: params.actorEmail || params.req?.user?.email || null,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId || null,
          metadata: sanitizedMetadata,
          requestId: params.requestId || params.req?.id || (params.req?.headers as any)?.['x-request-id'] || null,
          ipAddress,
          userAgent,
        },
      })
    } catch (err: any) {
      logger.error({ err: err.message, action: params.action }, 'Failed to write audit log')
    }
  }
}
