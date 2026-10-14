import { Request, Response } from 'express'
import { InventoryService } from '../services/inventory.service'
import {
  adjustStockSchema,
  updateInventorySchema,
  inventoryQuerySchema,
} from '../types/inventory.types'
import { logger } from '../config/logger'
import { sendControllerError } from '../utils/api-response'

import { clampPageSize, clampPageNumber } from '../utils/pagination'
export class InventoryController {
  /**
   * GET /api/v1/admin/inventory
   * List all warehouse inventory items with search, status filtering, and low stock toggle.
   */
  public static async listInventory(req: Request, res: Response): Promise<void> {
    try {
      const query = inventoryQuerySchema.parse(req.query)
      const result = await InventoryService.listInventory(query)
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list inventory')
      sendControllerError(res, error, 'Failed to list inventory', req.id)
    }
  }

  /**
   * GET /api/v1/admin/inventory/low-stock
   * Dedicated endpoint for critical low-stock warehouse alerts.
   */
  public static async getLowStockAlerts(req: Request, res: Response): Promise<void> {
    try {
      const page = clampPageNumber(req.query.page)
      const limit = clampPageSize(req.query.limit, 50)
      const result = await InventoryService.getLowStockAlerts(page, limit)
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to retrieve low-stock alerts')
      sendControllerError(res, error, 'Failed to retrieve low-stock alerts', req.id)
    }
  }

  /**
   * GET /api/v1/admin/inventory/:productId
   * Retrieve inventory status and quantities for a single product.
   */
  public static async getInventory(req: Request, res: Response): Promise<void> {
    try {
      const productId = String(req.params.productId)
      const result = await InventoryService.getInventoryByProductId(productId)
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message, productId: req.params.productId }, 'Failed to get inventory details')
      sendControllerError(res, error, 'Failed to get inventory details', req.id)
    }
  }

  /**
   * PATCH /api/v1/admin/inventory/:productId
   * Update reorder threshold, status, or configuration notes.
   */
  public static async updateInventory(req: Request, res: Response): Promise<void> {
    try {
      const productId = String(req.params.productId)
      const validated = updateInventorySchema.parse(req.body)
      const result = await InventoryService.updateInventorySettings(
        productId,
        validated,
        req.user?.id,
        req
      )
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message, productId: req.params.productId }, 'Failed to update inventory')
      sendControllerError(res, error, 'Failed to update inventory', req.id)
    }
  }

  /**
   * POST /api/v1/admin/inventory/:productId/adjust
   * Manual stock adjustment (ADD_STOCK, REMOVE_STOCK, RESTOCK, MANUAL_ADJUSTMENT).
   */
  public static async adjustStock(req: Request, res: Response): Promise<void> {
    try {
      const productId = String(req.params.productId)
      const validated = adjustStockSchema.parse(req.body)
      const result = await InventoryService.adjustStock(
        productId,
        validated,
        req.user?.id,
        req
      )
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message, productId: req.params.productId }, 'Failed to adjust stock')
      sendControllerError(res, error, 'Failed to adjust stock', req.id)
    }
  }

  /**
   * GET /api/v1/admin/inventory/:productId/history
   * Retrieve immutable historical audit trail of all stock movements.
   */
  public static async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const productId = String(req.params.productId)
      const page = clampPageNumber(req.query.page)
      const limit = clampPageSize(req.query.limit, 20)
      const result = await InventoryService.getInventoryHistory(productId, page, limit)
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message, productId: req.params.productId }, 'Failed to retrieve inventory history')
      sendControllerError(res, error, 'Failed to retrieve inventory history', req.id)
    }
  }
}
