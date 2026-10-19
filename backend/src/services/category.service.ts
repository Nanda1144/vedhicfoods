import { Request } from 'express'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors'
import { withCache, CACHE_TTL_SECONDS } from '../utils/cache'
import {
  invalidateCatalogCaches,
  categoryDetailCacheKey,
  categoryListCacheKey,
} from '../utils/catalog-cache'
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CategoryHierarchyResponse,
} from '../types/catalog.types'

export class CategoryService {
  /**
   * Helper to slugify a string into a clean lowercase URL slug.
   */
  public static slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  /**
   * Recursively verifies that setting parentId will not introduce a circular reference.
   * Walks up the ancestry tree from targetParentId; if categoryId is encountered, circularity exists.
   */
  private static async validateNoCircularHierarchy(categoryId: string, targetParentId: string): Promise<void> {
    if (categoryId === targetParentId) {
      throw new BadRequestError('A category cannot be its own parent')
    }

    let currentParentId: string | null = targetParentId
    const visited = new Set<string>([categoryId])

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        throw new BadRequestError('Circular hierarchy detected: cannot set parent to a descendant category')
      }
      visited.add(currentParentId)

      const parentCategory: { parentId: string | null } | null = await prisma.category.findUnique({
        where: { id: currentParentId },
        select: { parentId: true },
      })

      if (!parentCategory) break
      currentParentId = parentCategory.parentId
    }
  }

  /**
   * Formats a raw Prisma category into a structured API response.
   */
  private static formatCategory(cat: any): CategoryHierarchyResponse {
    return {
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      tagline: cat.tagline || null,
      description: cat.description || null,
      image: cat.image || null,
      accent: cat.accent || '#C9A24B',
      featured: Boolean(cat.featured),
      sortOrder: cat.sortOrder || 0,
      isActive: Boolean(cat.isActive),
      parentId: cat.parentId || null,
      parent: cat.parent
        ? {
            id: cat.parent.id,
            name: cat.parent.name,
            slug: cat.parent.slug,
          }
        : null,
      children: Array.isArray(cat.children) ? cat.children.map((child: any) => CategoryService.formatCategory(child)) : [],
      productCount: cat._count?.products ?? 0,
      createdAt: cat.createdAt ? cat.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: cat.updatedAt ? cat.updatedAt.toISOString() : new Date().toISOString(),
    }
  }

  /**
   * List categories with hierarchy and product counts.
   * Public requests only see active categories; admins can inspect all.
   */
  public static async listCategories(options: { activeOnly?: boolean; featured?: boolean } = {}): Promise<CategoryHierarchyResponse[]> {
    const { activeOnly = true, featured } = options

    // Only the public, active-only listing is cached. The admin listing
    // (`activeOnly: false`) includes inactive categories and is never shared.
    if (!activeOnly) {
      return this.listCategoriesUncached(options)
    }

    const key = categoryListCacheKey(true, featured)
    return withCache(key, CACHE_TTL_SECONDS.categoryList, () => this.listCategoriesUncached(options))
  }

  private static async listCategoriesUncached(options: { activeOnly?: boolean; featured?: boolean } = {}): Promise<CategoryHierarchyResponse[]> {
    const { activeOnly = true, featured } = options

    const where: any = {}
    if (activeOnly) {
      where.isActive = true
    }
    if (featured !== undefined) {
      where.featured = featured
    }

    const categories = await prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        parent: {
          select: { id: true, name: true, slug: true },
        },
        children: {
          where: activeOnly ? { isActive: true } : undefined,
          orderBy: { sortOrder: 'asc' },
          include: {
            _count: {
              select: { products: { where: { isDeleted: false, isActive: true, status: 'PUBLISHED' } } },
            },
          },
        },
        _count: {
          select: { products: { where: { isDeleted: false, isActive: true, status: 'PUBLISHED' } } },
        },
      },
    })

    return categories.map((cat) => this.formatCategory(cat))
  }

  /**
   * Get single category by ID or unique slug.
   */
  public static async getCategoryByIdOrSlug(idOrSlug: string, activeOnly = false): Promise<CategoryHierarchyResponse> {
    const key = categoryDetailCacheKey(idOrSlug, activeOnly)
    return withCache(key, CACHE_TTL_SECONDS.categoryDetail, () =>
      this.getCategoryByIdOrSlugUncached(idOrSlug, activeOnly)
    )
  }

  private static async getCategoryByIdOrSlugUncached(idOrSlug: string, activeOnly = false): Promise<CategoryHierarchyResponse> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)

    const category = await prisma.category.findFirst({
      where: {
        OR: isUuid ? [{ id: idOrSlug }] : [{ slug: idOrSlug.toLowerCase() }],
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: {
        parent: {
          select: { id: true, name: true, slug: true },
        },
        children: {
          where: activeOnly ? { isActive: true } : undefined,
          orderBy: { sortOrder: 'asc' },
          include: {
            _count: {
              select: { products: { where: { isDeleted: false, isActive: true, status: 'PUBLISHED' } } },
            },
          },
        },
        _count: {
          select: { products: { where: { isDeleted: false, isActive: true, status: 'PUBLISHED' } } },
        },
      },
    })

    if (!category) {
      throw new NotFoundError(`Category '${idOrSlug}' not found`)
    }

    return this.formatCategory(category)
  }

  /**
   * Create a new category with slug uniqueness and parent relationship checks.
   */
  public static async createCategory(
    data: CreateCategoryInput,
    actorId?: string,
    req?: Request
  ): Promise<CategoryHierarchyResponse> {
    const slug = data.slug || this.slugify(data.name)

    // Check slug uniqueness
    const existingSlug = await prisma.category.findUnique({
      where: { slug },
    })
    if (existingSlug) {
      throw new ConflictError(`Category with slug '${slug}' already exists`)
    }

    // Check name uniqueness (case-insensitive)
    const existingName = await prisma.category.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    })
    if (existingName) {
      throw new ConflictError(`Category with name '${data.name}' already exists`)
    }

    // Verify parent exists if specified
    if (data.parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: data.parentId },
      })
      if (!parent) {
        throw new BadRequestError(`Parent category '${data.parentId}' does not exist`)
      }
    }

    const created = await prisma.category.create({
      data: {
        name: data.name,
        slug,
        tagline: data.tagline,
        description: data.description,
        image: data.image,
        accent: data.accent || '#C9A24B',
        featured: data.featured ?? true,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        parentId: data.parentId || null,
      },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: true,
        _count: { select: { products: true } },
      },
    })

    // Record audit event
    await AuditService.record({
      action: 'CATEGORY_CREATED',
      entity: 'Category',
      entityId: created.id,
      actorId,
      metadata: { name: created.name, slug: created.slug, parentId: created.parentId },
      req,
    })

    await invalidateCatalogCaches()

    logger.info({ categoryId: created.id, name: created.name, slug: created.slug }, 'Category created successfully')
    return this.formatCategory(created)
  }

  /**
   * Update category with circular hierarchy checks and duplicate prevention.
   */
  public static async updateCategory(
    id: string,
    data: UpdateCategoryInput,
    actorId?: string,
    req?: Request
  ): Promise<CategoryHierarchyResponse> {
    const existing = await prisma.category.findUnique({
      where: { id },
    })

    if (!existing) {
      throw new NotFoundError(`Category '${id}' not found`)
    }

    // Slug check if updating slug
    if (data.slug && data.slug !== existing.slug) {
      const slugCollision = await prisma.category.findUnique({
        where: { slug: data.slug },
      })
      if (slugCollision) {
        throw new ConflictError(`Category with slug '${data.slug}' already exists`)
      }
    }

    // Name check if updating name
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const nameCollision = await prisma.category.findFirst({
        where: {
          name: { equals: data.name, mode: 'insensitive' },
          id: { not: id },
        },
      })
      if (nameCollision) {
        throw new ConflictError(`Category with name '${data.name}' already exists`)
      }
    }

    // Validate circular hierarchy if parentId is being modified
    if (data.parentId !== undefined && data.parentId !== null) {
      await this.validateNoCircularHierarchy(id, data.parentId)

      const parent = await prisma.category.findUnique({
        where: { id: data.parentId },
      })
      if (!parent) {
        throw new BadRequestError(`Parent category '${data.parentId}' does not exist`)
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name : undefined,
        slug: data.slug !== undefined ? data.slug : undefined,
        tagline: data.tagline !== undefined ? data.tagline : undefined,
        description: data.description !== undefined ? data.description : undefined,
        image: data.image !== undefined ? data.image : undefined,
        accent: data.accent !== undefined ? data.accent : undefined,
        featured: data.featured !== undefined ? data.featured : undefined,
        sortOrder: data.sortOrder !== undefined ? data.sortOrder : undefined,
        isActive: data.isActive !== undefined ? data.isActive : undefined,
        parentId: data.parentId !== undefined ? data.parentId : undefined,
      },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: true,
        _count: { select: { products: true } },
      },
    })

    // Record audit event
    await AuditService.record({
      action: 'CATEGORY_UPDATED',
      entity: 'Category',
      entityId: updated.id,
      actorId,
      metadata: {
        old: { name: existing.name, slug: existing.slug, parentId: existing.parentId, isActive: existing.isActive },
        new: { name: updated.name, slug: updated.slug, parentId: updated.parentId, isActive: updated.isActive },
      },
      req,
    })

    await invalidateCatalogCaches()

    logger.info({ categoryId: updated.id, name: updated.name }, 'Category updated successfully')
    return this.formatCategory(updated)
  }

  /**
   * Delete category safely.
   * Prevents deletion if active products or child categories still depend on it.
   */
  public static async deleteCategory(
    id: string,
    actorId?: string,
    req?: Request
  ): Promise<{ success: boolean; message: string }> {
    const existing = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products: { where: { isDeleted: false } },
            children: true,
          },
        },
      },
    })

    if (!existing) {
      throw new NotFoundError(`Category '${id}' not found`)
    }

    // Safety Rule 1: Prevent deletion if products exist
    if (existing._count.products > 0) {
      throw new BadRequestError(
        `Cannot delete category '${existing.name}'. It contains ${existing._count.products} active product(s). Please reassign or delete these products first.`
      )
    }

    // Safety Rule 2: Prevent deletion if subcategories exist
    if (existing._count.children > 0) {
      throw new BadRequestError(
        `Cannot delete category '${existing.name}'. It has ${existing._count.children} subcategory/subcategories. Please reassign or delete subcategories first.`
      )
    }

    // Perform deletion
    await prisma.category.delete({
      where: { id },
    })

    // Record audit event
    await AuditService.record({
      action: 'CATEGORY_DELETED',
      entity: 'Category',
      entityId: id,
      actorId,
      metadata: { name: existing.name, slug: existing.slug },
      req,
    })

    await invalidateCatalogCaches()

    logger.info({ categoryId: id, name: existing.name }, 'Category deleted safely')
    return { success: true, message: `Category '${existing.name}' successfully deleted` }
  }
}
