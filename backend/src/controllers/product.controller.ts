import { Request, Response, NextFunction } from 'express'
import { ProductService } from '../services/product.service'
import {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
  presignedUrlRequestSchema,
  addProductImageSchema,
  reorderImagesSchema,
} from '../types/catalog.types'

export class ProductController {
  /**
   * GET /api/v1/products
   * Public product catalog with search, category filtering, price filtering, sorting, pagination.
   */
  public static async listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = productQuerySchema.parse(req.query)
      const result = await ProductService.listProducts(query, false)
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/admin/products
   * Admin product catalog listing with full inventory, status flags, and soft-deleted support.
   */
  public static async listAdminProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = productQuerySchema.parse(req.query)
      const result = await ProductService.listProducts(query, true)
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/products/:idOrSlug
   * Get single product detail by ID or Slug.
   */
  public static async getProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const idOrSlug = String(req.params.slug || req.params.idOrSlug || req.params.id)
      const product = await ProductService.getProduct(idOrSlug, false)
      res.status(200).json(product)
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/admin/products/:id
   * Admin inspect single product with internal details.
   */
  public static async getAdminProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const product = await ProductService.getProduct(id, true)
      res.status(200).json(product)
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/v1/admin/products
   * Admin creates a new product in PostgreSQL (Permission: products.create).
   */
  public static async createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = createProductSchema.parse(req.body)
      const actorId = req.user?.id

      const created = await ProductService.createProduct(validated, actorId, req)
      res.status(201).json(created)
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/products/:id & PUT /api/v1/admin/products/:id
   * Admin updates product attributes, prices, stock, and status (Permission: products.update).
   */
  public static async updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const validated = updateProductSchema.parse(req.body)
      const actorId = req.user?.id

      const updated = await ProductService.updateProduct(id, validated, actorId, req)
      res.status(200).json(updated)
    } catch (error) {
      next(error)
    }
  }

  /**
   * DELETE /api/v1/admin/products/:id
   * Admin soft-deletes or archives product (Permission: products.delete).
   */
  public static async deleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const actorId = req.user?.id

      const result = await ProductService.deleteProduct(id, actorId, req)
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }

  // ==========================================
  // S3 IMAGE MANAGEMENT HANDLERS
  // ==========================================

  /**
   * POST /api/v1/admin/products/:id/images/presigned-url
   * Generate pre-signed S3 upload URL for direct client upload (Permission: products.update).
   */
  public static async generateImagePresignedUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.id)
      const validated = presignedUrlRequestSchema.parse(req.body)

      const result = await ProductService.generateImagePresignedUrl(productId, validated)
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/v1/admin/products/:id/images
   * Attach an uploaded image to product gallery (Permission: products.update).
   */
  public static async addImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.id)
      const validated = addProductImageSchema.parse(req.body)
      const actorId = req.user?.id

      const image = await ProductService.addImage(productId, validated, actorId, req)
      res.status(201).json(image)
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/products/:id/images/:imageId/primary
   * Set primary image for product gallery (Permission: products.update).
   */
  public static async setPrimaryImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.id)
      const imageId = String(req.params.imageId)
      const actorId = req.user?.id

      const images = await ProductService.setPrimaryImage(productId, imageId, actorId, req)
      res.status(200).json({ success: true, images })
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/products/:id/images/reorder
   * Reorder gallery display orders (Permission: products.update).
   */
  public static async reorderImages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.id)
      const validated = reorderImagesSchema.parse(req.body)
      const actorId = req.user?.id

      const images = await ProductService.reorderImages(productId, validated, actorId, req)
      res.status(200).json({ success: true, images })
    } catch (error) {
      next(error)
    }
  }

  /**
   * DELETE /api/v1/admin/products/:id/images/:imageId
   * Remove image from product and delete S3 object (Permission: products.update).
   */
  public static async deleteImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = String(req.params.id)
      const imageId = String(req.params.imageId)
      const actorId = req.user?.id

      const result = await ProductService.deleteImage(productId, imageId, actorId, req)
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }
}
