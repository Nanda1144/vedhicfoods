import { Request, Response } from 'express'
import { CartService } from '../services/cart.service'
import { logger } from '../config/logger'
import { sendControllerError } from '../utils/api-response'

export class CartController {
  private static extractIdentity(req: Request) {
    const userId = req.user?.id || null
    const sessionToken =
      (req.headers['x-session-token'] as string) ||
      (req.query.sessionToken as string) ||
      (req.body?.sessionToken as string) ||
      null
    return { userId, sessionToken }
  }

  public static async getCart(req: Request, res: Response): Promise<void> {
    try {
      const { userId, sessionToken } = CartController.extractIdentity(req)
      const cart = await CartService.getCart(userId, sessionToken)
      res.status(200).json(cart)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get cart')
      sendControllerError(res, error, 'Failed to get cart', req.id)
    }
  }

  public static async addItem(req: Request, res: Response): Promise<void> {
    try {
      const { userId, sessionToken } = CartController.extractIdentity(req)
      const productId = req.body.productId || req.body.slug || req.body.id
      const quantity = req.body.quantity !== undefined ? parseInt(req.body.quantity, 10) : 1

      if (!productId) {
        res.status(400).json({ error: 'Product ID or slug is required' })
        return
      }

      // Notice: frontend price, discount, or totals in req.body are strictly ignored!
      const cart = await CartService.addItem(productId, quantity, userId, sessionToken)
      res.status(200).json(cart)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to add item to cart')
      sendControllerError(res, error, 'Failed to add item to cart', req.id)
    }
  }

  public static async updateItem(req: Request, res: Response): Promise<void> {
    try {
      const { userId, sessionToken } = CartController.extractIdentity(req)
      const itemId = String(req.params.itemId || req.params.productId)
      const quantity = parseInt(String(req.body.quantity), 10)

      if (isNaN(quantity)) {
        res.status(400).json({ error: 'Quantity must be a valid integer' })
        return
      }

      const cart = await CartService.updateItemQuantity(itemId, quantity, userId, sessionToken)
      res.status(200).json(cart)
    } catch (error: any) {
      logger.error({ error: error.message, itemId: req.params.itemId }, 'Failed to update cart item')
      sendControllerError(res, error, 'Failed to update cart item', req.id)
    }
  }

  public static async removeItem(req: Request, res: Response): Promise<void> {
    try {
      const { userId, sessionToken } = CartController.extractIdentity(req)
      const itemId = String(req.params.itemId || req.params.productId)
      const cart = await CartService.removeItem(itemId, userId, sessionToken)
      res.status(200).json(cart)
    } catch (error: any) {
      logger.error({ error: error.message, itemId: req.params.itemId }, 'Failed to remove cart item')
      sendControllerError(res, error, 'Failed to remove cart item', req.id)
    }
  }

  public static async validateCart(req: Request, res: Response): Promise<void> {
    try {
      const { userId, sessionToken } = CartController.extractIdentity(req)
      const result = await CartService.validateCart(userId, sessionToken)
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to validate cart')
      sendControllerError(res, error, 'Failed to validate cart', req.id)
    }
  }

  public static async clearCart(req: Request, res: Response): Promise<void> {
    try {
      const { userId, sessionToken } = CartController.extractIdentity(req)
      const cart = await CartService.clearCart(userId, sessionToken)
      res.status(200).json(cart)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to clear cart')
      sendControllerError(res, error, 'Failed to clear cart', req.id)
    }
  }

  public static async mergeCart(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id
      const sessionToken = req.body.sessionToken || (req.headers['x-session-token'] as string)

      if (!userId) {
        res.status(401).json({ error: 'Authentication required to merge cart into user account' })
        return
      }

      if (!sessionToken) {
        res.status(400).json({ error: 'Guest session token is required to merge' })
        return
      }

      const cart = await CartService.mergeGuestCart(userId, sessionToken)
      res.status(200).json(cart)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to merge cart')
      sendControllerError(res, error, 'Failed to merge cart', req.id)
    }
  }
}
