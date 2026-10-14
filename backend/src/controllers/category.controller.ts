import { Request, Response, NextFunction } from 'express'
import { CategoryService } from '../services/category.service'
import { createCategorySchema, updateCategorySchema } from '../types/catalog.types'

export class CategoryController {
  /**
   * GET /api/v1/categories
   * Public storefront category listing with hierarchy and active product counts.
   */
  public static async listCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const featured = req.query.featured !== undefined ? req.query.featured === 'true' : undefined
      const categories = await CategoryService.listCategories({ activeOnly: true, featured })
      res.status(200).json(categories)
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/admin/categories
   * Administrative category listing including inactive categories.
   */
  public static async listAdminCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await CategoryService.listCategories({ activeOnly: false })
      res.status(200).json(categories)
    } catch (error) {
      next(error)
    }
  }

  /**
   * GET /api/v1/categories/:idOrSlug
   * Get single category by UUID or slug.
   */
  public static async getCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const idOrSlug = String(req.params.idOrSlug || req.params.id)
      const category = await CategoryService.getCategoryByIdOrSlug(idOrSlug)
      res.status(200).json(category)
    } catch (error) {
      next(error)
    }
  }

  /**
   * POST /api/v1/admin/categories
   * Create a new category (Permission: categories.create).
   */
  public static async createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = createCategorySchema.parse(req.body)
      const actorId = req.user?.id

      const created = await CategoryService.createCategory(validated, actorId, req)
      res.status(201).json(created)
    } catch (error) {
      next(error)
    }
  }

  /**
   * PATCH /api/v1/admin/categories/:id
   * Update category properties (Permission: categories.update).
   */
  public static async updateCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const validated = updateCategorySchema.parse(req.body)
      const actorId = req.user?.id

      const updated = await CategoryService.updateCategory(id, validated, actorId, req)
      res.status(200).json(updated)
    } catch (error) {
      next(error)
    }
  }

  /**
   * DELETE /api/v1/admin/categories/:id
   * Delete category safely (Permission: categories.delete).
   */
  public static async deleteCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = String(req.params.id)
      const actorId = req.user?.id

      const result = await CategoryService.deleteCategory(id, actorId, req)
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }
}
