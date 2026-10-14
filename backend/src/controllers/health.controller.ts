import { Request, Response, NextFunction } from 'express'
import { HealthService } from '../services/health.service'
import { sendSuccess } from '../utils/api-response'
import { HTTP_STATUS } from '../constants'

export class HealthController {
  public static getLiveness(_req: Request, res: Response, _next: NextFunction): void {
    const liveness = HealthService.getLiveness()
    sendSuccess(res, liveness, 'Service is healthy', HTTP_STATUS.OK)
  }

  public static async getReadiness(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const readiness = await HealthService.getReadiness()
      // `degraded` still answers 200: the instance is serving traffic and the
      // condition is reported in `checks` for operators. Only `unhealthy` (no
      // database) removes it from rotation.
      const statusCode =
        readiness.status === 'unhealthy' ? HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.OK
      sendSuccess(res, readiness, `Service readiness status: ${readiness.status}`, statusCode)
    } catch (error) {
      next(error)
    }
  }
}
