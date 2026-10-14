import { Request, Response, NextFunction } from 'express'
import { DeliveryService } from '../services/delivery.service'
import {
  listDeliveriesQuerySchema,
  updateDeliverySchema,
  assignDeliverySchema,
  updateDeliveryStatusSchema,
} from '../types/delivery.types'
import { sendSuccess } from '../utils/api-response'
import { UnauthorizedError } from '../utils/errors'

export class DeliveryController {
  /**
   * GET /api/v1/admin/delivery
   * List deliveries with pagination, filters, and search.
   */
  public static async listDeliveries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listDeliveriesQuerySchema.parse(req.query)
      const result = await DeliveryService.listDeliveries(query)
      res.status(200).json({
        success: true,
        message: 'Deliveries retrieved successfully',
        ...result,
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/admin/delivery/:id
   * Get single delivery by delivery ID, order ID, or orderNumber.
   */
  public static async getDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const delivery = await DeliveryService.getDeliveryById(id)
      sendSuccess(res, delivery, 'Delivery details retrieved successfully')
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/delivery/:id
   * Update courier, tracking, estimated delivery, notes, or recipient contact.
   */
  public static async updateDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const input = updateDeliverySchema.parse(req.body)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const updated = await DeliveryService.updateDelivery(id, input, actor)
      sendSuccess(res, updated, 'Delivery updated successfully')
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/v1/admin/delivery/:id/assign
   * Assign or reassign delivery staff member.
   */
  public static async assignDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const input = assignDeliverySchema.parse(req.body)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const assigned = await DeliveryService.assignStaff(id, input, actor)
      sendSuccess(res, assigned, 'Delivery staff assigned successfully')
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/delivery/:id/status
   * Controlled state transition for delivery.
   */
  public static async updateDeliveryStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const input = updateDeliveryStatusSchema.parse(req.body)
      const actor = {
        id: req.user?.id || 'SYSTEM',
        email: req.user?.email || 'system@vedhicfoods.com',
      }
      const updated = await DeliveryService.updateDeliveryStatus(id, input, actor)
      sendSuccess(res, updated, 'Delivery status updated successfully')
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/orders/:orderNumberOrId/delivery
   * Customer delivery tracking endpoint with ownership check.
   */
  public static async getCustomerDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required to view delivery tracking')
      }
      const orderNumberOrId = String(req.params.orderNumberOrId)
      const delivery = await DeliveryService.getCustomerDelivery(
        req.user.id,
        orderNumberOrId,
        req.user.roles || [],
        req.user.permissions || []
      )
      sendSuccess(res, delivery, 'Delivery tracking retrieved successfully')
    } catch (error) {
      next(error)
    }
  }
}
