import { Request } from 'express'
import { Prisma, ProductStatus, InventoryStatus } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from '../utils/errors'
import { S3Service } from '../integrations/aws/s3/s3.service'
import { withCache, CACHE_TTL_SECONDS } from '../utils/cache'
import {
  invalidateCatalogCaches,
  productDetailCacheKey,
  productListCacheKey,
} from '../utils/catalog-cache'
import {
  CreateProductInput,
  UpdateProductInput,
  ProductQueryInput,
  PresignedUrlRequestInput,
  AddProductImageInput,
  ReorderImagesInput,
} from '../types/catalog.types'

export class ProductService {
  /**
   * Helper to slugify product names.
   */
  public static slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  /**
   * Formats a product for public storefront consumption.
   * Strips admin internals and computes availability status.
   */
  public static formatPublicProduct(p: any) {
    const availableStock = p.inventory ? Number(p.inventory.availableQuantity) : Number(p.stock || 0)
    const threshold = p.inventory ? Number(p.inventory.reorderThreshold || 10) : 10
    const isOutOfStock = availableStock <= 0
    let availability = 'IN_STOCK'
    if (isOutOfStock) {
      availability = 'OUT_OF_STOCK'
    } else if (availableStock <= threshold) {
      availability = 'LOW_STOCK'
    }

    const images = Array.isArray(p.images) && p.images.length > 0
      ? p.images.map((img: any) => (typeof img === 'string' ? img : img.imageUrl))
      : ['https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80']

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      categoryId: p.categoryId,
      categorySlug: p.category?.slug || '',
      categoryName: p.category?.name || '',
      category: p.category
        ? {
            id: p.category.id,
            name: p.category.name,
            slug: p.category.slug,
          }
        : null,
      shortDescription: p.shortDescription || '',
      description: p.description || '',
      price: Number(p.price),
      mrp: Number(p.mrp),
      discount: Number(p.discount || 0),
      currency: (p.currency as 'INR') || 'INR',
      unit: p.unit || 'piece',
      stock: Math.max(0, availableStock),
      availability,
      isAvailable: !isOutOfStock && Boolean(p.isActive) && p.status === ProductStatus.PUBLISHED,
      sku: p.sku || '',
      rating: Number(p.rating || 4.8),
      reviewCount: Number(p.reviewCount || 0),
      images,
      primaryImage: p.images?.find((img: any) => img.isPrimary)?.imageUrl || images[0],
      gallery: Array.isArray(p.images)
        ? p.images.map((img: any) => ({
            id: img.id,
            imageUrl: img.imageUrl,
            altText: img.altText || null,
            isPrimary: Boolean(img.isPrimary),
            displayOrder: img.displayOrder || 0,
          }))
        : [],
      tags: Array.isArray(p.tags) ? p.tags : [],
      ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
      allergens: Array.isArray(p.allergens) ? p.allergens : [],
      shelfLife: p.shelfLife || '6 Months',
      storage: p.storage || 'Store in a cool, dry place',
      nutrition: Array.isArray(p.nutrition) ? p.nutrition : [],
      specifications: Array.isArray(p.specifications) ? p.specifications : [],
      isOrganic: Boolean(p.isOrganic),
      isBestSeller: Boolean(p.isBestSeller),
      isNew: Boolean(p.isNew),
      isFeatured: Boolean(p.isFeatured),
      active: Boolean(p.isActive),
      status: p.status,
      createdAt: p.createdAt ? p.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: p.updatedAt ? p.updatedAt.toISOString() : new Date().toISOString(),
    }
  }

  /**
   * Formats a product for administrative inspection.
   * Includes inventory details, deletion flags, and full audit metadata.
   */
  public static formatAdminProduct(p: any) {
    const publicView = this.formatPublicProduct(p)
    return {
      ...publicView,
      isDeleted: Boolean(p.isDeleted),
      deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
      inventory: p.inventory
        ? {
            id: p.inventory.id,
            availableQuantity: p.inventory.availableQuantity,
            reservedQuantity: p.inventory.reservedQuantity,
            totalStock: (p.inventory.availableQuantity || 0) + (p.inventory.reservedQuantity || 0),
            soldQuantity: p.inventory.soldQuantity,
            reorderThreshold: p.inventory.reorderThreshold,
            status: p.inventory.status,
          }
        : null,
      metaTitle: p.metaTitle || null,
      metaDescription: p.metaDescription || null,
      metaKeywords: Array.isArray(p.metaKeywords) ? p.metaKeywords : [],
    }
  }

  /**
   * List products with search, filtering, sorting, and pagination.
   *
   * Public (storefront) reads are cached for a few seconds. Admin reads are
   * never cached: they include internal inventory/soft-delete fields and are not
   * shared between visitors. `withCache` falls straight through to the database
   * whenever the cache is disabled or unavailable.
   */
  public static async listProducts(query: ProductQueryInput, isAdmin = false) {
    if (isAdmin) {
      return this.listProductsUncached(query, isAdmin)
    }

    const key = productListCacheKey(query as unknown as Record<string, unknown>, false)
    return withCache(key, CACHE_TTL_SECONDS.productList, () => this.listProductsUncached(query, false))
  }

  /**
   * Uncached catalog listing. The cache wrapper above is the only entry point
   * for callers; this carries the query construction and the ranked-search path.
   */
  private static async listProductsUncached(query: ProductQueryInput, isAdmin = false) {
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.per_page ?? query.limit ?? 20))
    const search = (query.q || query.search)?.trim()
    const categoryFilter = (query.category || query.category_slug)?.trim()
    const minPrice = query.minPrice ?? query.min_price
    const maxPrice = query.maxPrice ?? query.max_price
    const available = query.available
    const featured = query.featured
    const tag = query.tag?.trim()
    const sort = query.sort || 'featured'
    const statusFilter = query.status

    const where: any = {}

    // Storefront vs Admin visibility
    if (!isAdmin) {
      where.isDeleted = false
      where.isActive = true
      where.status = ProductStatus.PUBLISHED
    } else {
      if (statusFilter && statusFilter !== 'ALL') {
        where.status = statusFilter as ProductStatus
      }
      where.isDeleted = false
    }

    // Category filter (by ID or Slug)
    if (categoryFilter) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryFilter)
      if (isUuid) {
        where.categoryId = categoryFilter
      } else {
        where.category = { slug: categoryFilter.toLowerCase() }
      }
    }

    // Free-text search is handled separately below via PostgreSQL full-text
    // search over the generated `search_vector` column (ranked by relevance).
    // Every other filter still flows through the Prisma `where` built here.

    // Tag filter
    if (tag) {
      where.tags = { has: tag.toLowerCase() }
    }

    // Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {}
      if (minPrice !== undefined) where.price.gte = new Prisma.Decimal(minPrice)
      if (maxPrice !== undefined) where.price.lte = new Prisma.Decimal(maxPrice)
    }

    // Availability filter
    if (available === true) {
      where.stock = { gt: 0 }
      where.isActive = true
    } else if (available === false) {
      where.stock = { lte: 0 }
    }

    // Featured filter
    if (featured !== undefined) {
      where.isFeatured = featured
    }

    // Organic / best-seller / new-arrival flags.
    // The storefront previously requested `is_featured`, which is not in the
    // schema, so Zod stripped it and the "Featured" shelf silently returned the
    // entire catalogue. Explicit flags are matched here instead.
    if (query.is_organic !== undefined) {
      where.isOrganic = query.is_organic
    }
    if (query.best_seller !== undefined) {
      where.isBestSeller = query.best_seller
    }
    if (query.is_new !== undefined) {
      where.isNew = query.is_new
    }

    // Minimum average rating.
    if (query.min_rating !== undefined) {
      where.rating = { gte: new Prisma.Decimal(query.min_rating) }
    }

    // Multiple tags, combined with AND so a filter can narrow results rather
    // than widen them. `tags=masala,ghee` matches products carrying both.
    if (query.tags) {
      const requested = query.tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
      if (requested.length) {
        // `AND` (not `OR`) is deliberate: an empty OR array would be a no-op.
        where.AND = requested.map((tag) => ({ tags: { has: tag } }))
      }
    }

    // Sorting
    let orderBy: any = [{ isFeatured: 'desc' }, { isBestSeller: 'desc' }, { rating: 'desc' }]
    switch (sort) {
      case 'price_asc':
      case 'price-asc':
        orderBy = { price: 'asc' }
        break
      case 'price_desc':
      case 'price-desc':
        orderBy = { price: 'desc' }
        break
      case 'rating':
        orderBy = { rating: 'desc' }
        break
      case 'newest':
        orderBy = { createdAt: 'desc' }
        break
      case 'name_asc':
      case 'name-asc':
        orderBy = { name: 'asc' }
        break
      case 'bestsellers':
        orderBy = [{ isBestSeller: 'desc' }, { rating: 'desc' }]
        break
      case 'featured':
      default:
        orderBy = [{ isFeatured: 'desc' }, { isBestSeller: 'desc' }, { rating: 'desc' }]
        break
    }

    // A free-text term is ranked by relevance, which Prisma's `orderBy` cannot
    // express, so it takes the dedicated full-text path. Everything else uses
    // the normal counted/filtered listing.
    if (search) {
      return this.searchProductsRanked(search, where, page, limit, isAdmin)
    }

    const total = await prisma.product.count({ where })
    const products = await prisma.product.findMany({
      where,
      include: {
        category: true,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
        },
        inventory: true,
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    })

    const items = products.map((p) => (isAdmin ? this.formatAdminProduct(p) : this.formatPublicProduct(p)))

    return {
      items,
      page,
      limit,
      per_page: limit,
      total,
      totalPages: Math.ceil(total / limit),
      total_pages: Math.ceil(total / limit),
    }
  }

  /**
   * Ranked full-text product search.
   *
   * Uses PostgreSQL's `search_vector` generated column (migration
   * 20261014000000_product_full_text_search) and `websearch_to_tsquery`, which
   * parses the visitor's term safely — quotes, `or` and `-` are understood and
   * no raw operator syntax is interpolated. The match is parameterised, so it is
   * SQL-injection safe.
   *
   * Relevance ordering cannot be expressed through Prisma's `orderBy`, so the
   * ranked ids come from a raw query and the non-search filters are then applied
   * through the same Prisma `where` as the normal listing (soft-delete, active,
   * status, category, price, stock, flags, multi-tag). All of that filtering is
   * done by PostgreSQL against the ranked id set; only the current page's rows
   * are materialised, and the final order is the relevance order.
   *
   * The behaviour when `search` is empty is unchanged: callers take the normal
   * path above.
   */
  private static async searchProductsRanked(
    search: string,
    where: any,
    page: number,
    limit: number,
    isAdmin: boolean,
  ) {
    const ranked = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "products"
      WHERE "search_vector" @@ websearch_to_tsquery('english', ${search})
      ORDER BY ts_rank("search_vector", websearch_to_tsquery('english', ${search})) DESC,
               "id" ASC
    `

    const rankedIds = ranked.map((row) => row.id)

    const emptyPage = {
      items: [] as any[],
      page,
      limit,
      per_page: limit,
      total: 0,
      totalPages: 0,
      total_pages: 0,
    }

    if (rankedIds.length === 0) {
      return emptyPage
    }

    // Apply every non-search filter through the same `where`, keeping only ids
    // to avoid loading full rows for candidates not on this page.
    const allowed = await prisma.product.findMany({
      where: { ...where, id: { in: rankedIds } },
      select: { id: true },
    })
    const allowedIds = new Set(allowed.map((p) => p.id))
    const filteredIds = rankedIds.filter((id) => allowedIds.has(id))
    const total = filteredIds.length

    const skip = (page - 1) * limit
    const pageIds = filteredIds.slice(skip, skip + limit)

    if (pageIds.length === 0) {
      return {
        items: [] as any[],
        page,
        limit,
        per_page: limit,
        total,
        totalPages: Math.ceil(total / limit),
        total_pages: Math.ceil(total / limit),
      }
    }

    const products = await prisma.product.findMany({
      where: { id: { in: pageIds } },
      include: {
        category: true,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
        },
        inventory: true,
      },
    })

    // `findMany` returns rows in database order, not the ranked order, so the
    // page is re-sequenced from `pageIds`.
    const byId = new Map(products.map((p) => [p.id, p]))
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => (isAdmin ? this.formatAdminProduct(p) : this.formatPublicProduct(p)))

    return {
      items,
      page,
      limit,
      per_page: limit,
      total,
      totalPages: Math.ceil(total / limit),
      total_pages: Math.ceil(total / limit),
    }
  }

  /**
   * Get single product by ID or Slug.
   *
   * Public detail reads are cached; admin reads are not (they expose internal
   * inventory and soft-delete state). A miss or an unavailable cache falls
   * through to the database.
   */
  public static async getProduct(idOrSlug: string, isAdmin = false) {
    if (isAdmin) {
      return this.getProductUncached(idOrSlug, true)
    }

    const key = productDetailCacheKey(idOrSlug, false)
    return withCache(key, CACHE_TTL_SECONDS.productDetail, () => this.getProductUncached(idOrSlug, false))
  }

  private static async getProductUncached(idOrSlug: string, isAdmin = false) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)

    const where: any = {
      OR: isUuid ? [{ id: idOrSlug }] : [{ slug: idOrSlug.toLowerCase() }],
    }

    if (!isAdmin) {
      where.isDeleted = false
      where.isActive = true
      where.status = ProductStatus.PUBLISHED
    }

    const product = await prisma.product.findFirst({
      where,
      include: {
        category: true,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
        },
        inventory: true,
      },
    })

    if (!product) {
      throw new NotFoundError(`Product '${idOrSlug}' not found`)
    }

    return isAdmin ? this.formatAdminProduct(product) : this.formatPublicProduct(product)
  }

  /**
   * Create a new product in PostgreSQL with inventory record and audit logging.
   */
  public static async createProduct(
    data: CreateProductInput,
    actorId?: string,
    req?: Request
  ) {
    // 1. Resolve Category
    let categoryId = data.categoryId
    if (!categoryId && data.categorySlug) {
      const category = await prisma.category.findUnique({
        where: { slug: data.categorySlug.toLowerCase() },
      })
      if (!category) {
        throw new BadRequestError(`Category with slug '${data.categorySlug}' not found`)
      }
      categoryId = category.id
    }

    if (!categoryId) {
      const defaultCategory = await prisma.category.findFirst({ where: { isActive: true } })
      if (defaultCategory) {
        categoryId = defaultCategory.id
      } else {
        throw new BadRequestError('A valid category must be provided')
      }
    }

    // Verify category exists
    const categoryExists = await prisma.category.findUnique({
      where: { id: categoryId },
    })
    if (!categoryExists) {
      throw new BadRequestError(`Category with ID '${categoryId}' not found`)
    }

    // 2. Prevent duplicate SKU
    const existingSku = await prisma.product.findUnique({
      where: { sku: data.sku.trim() },
    })
    if (existingSku) {
      throw new ConflictError(`Product with SKU '${data.sku}' already exists`)
    }

    // 3. Resolve and validate unique Slug
    const baseSlug = data.slug || this.slugify(data.name)
    let finalSlug = baseSlug
    const existingSlug = await prisma.product.findUnique({
      where: { slug: finalSlug },
    })
    if (existingSlug) {
      finalSlug = `${baseSlug}-${Date.now().toString(36)}`
    }

    // 4. Exact Decimal Monetary Precision
    const priceDecimal = new Prisma.Decimal(data.price)
    const mrpDecimal = new Prisma.Decimal(data.mrp)

    if (priceDecimal.greaterThan(mrpDecimal)) {
      throw new BadRequestError('Selling price cannot exceed the original MRP price')
    }

    const discountDecimal = data.discount !== undefined
      ? new Prisma.Decimal(data.discount)
      : mrpDecimal.minus(priceDecimal)

    const stock = data.stock ?? 0
    const invStatus: InventoryStatus = stock > 10 ? InventoryStatus.IN_STOCK : stock > 0 ? InventoryStatus.LOW_STOCK : InventoryStatus.OUT_OF_STOCK

    // 5. Transactional Creation (Product + Linked Inventory + Optional Images)
    const createdProduct = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          slug: finalSlug,
          name: data.name.trim(),
          categoryId,
          shortDescription: data.shortDescription,
          description: data.description,
          price: priceDecimal,
          mrp: mrpDecimal,
          discount: discountDecimal,
          currency: data.currency || 'INR',
          unit: data.unit || 'piece',
          netWeight: new Prisma.Decimal(data.netWeight ?? 0),
          stock,
          sku: data.sku.trim(),
          rating: new Prisma.Decimal(data.rating ?? 4.8),
          reviewCount: data.reviewCount ?? 0,
          tags: data.tags || [],
          ingredients: data.ingredients || [],
          allergens: data.allergens || [],
          shelfLife: data.shelfLife || '6 Months',
          storage: data.storage || 'Store in a cool, dry place',
          nutrition: data.nutrition || [],
          specifications: data.specifications || [],
          isOrganic: data.isOrganic ?? true,
          isBestSeller: data.isBestSeller ?? false,
          isNew: data.isNew ?? false,
          isFeatured: data.isFeatured ?? false,
          isActive: data.isActive ?? true,
          status: data.status || ProductStatus.PUBLISHED,
          metaTitle: data.metaTitle,
          metaDescription: data.metaDescription,
          metaKeywords: data.metaKeywords || [],
        },
      })

      // Create linked inventory record
      const initialInv = await tx.inventory.create({
        data: {
          productId: product.id,
          availableQuantity: stock,
          status: invStatus,
          reorderThreshold: 10,
        },
      })

      if (stock > 0) {
        await tx.inventoryLog.create({
          data: {
            inventoryId: initialInv.id,
            productId: product.id,
            actorId: actorId || null,
            actorEmail: req?.user?.email || null,
            operation: 'ADD_STOCK',
            previousQuantity: 0,
            newQuantity: stock,
            quantityChange: stock,
            previousReserved: 0,
            newReserved: 0,
            reason: 'Initial stock on product creation',
          },
        })
      }

      // Create images if provided
      if (Array.isArray(data.images) && data.images.length > 0) {
        const imageRecords = data.images.map((img: any, index: number) => {
          if (typeof img === 'string') {
            return {
              productId: product.id,
              imageUrl: img,
              displayOrder: index,
              isPrimary: index === 0,
            }
          }
          return {
            productId: product.id,
            imageUrl: img.imageUrl,
            s3Key: img.s3Key,
            altText: img.altText,
            displayOrder: img.displayOrder ?? index,
            isPrimary: img.isPrimary ?? index === 0,
          }
        })

        await tx.productImage.createMany({
          data: imageRecords,
        })
      }

      return tx.product.findUnique({
        where: { id: product.id },
        include: {
          category: true,
          images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
          inventory: true,
        },
      })
    }, { timeout: 25000, maxWait: 20000 })

    // 6. Record Audit Event
    await AuditService.record({
      action: 'PRODUCT_CREATED',
      entity: 'Product',
      entityId: createdProduct!.id,
      actorId,
      metadata: {
        name: createdProduct!.name,
        sku: createdProduct!.sku,
        price: createdProduct!.price.toString(),
        mrp: createdProduct!.mrp.toString(),
        stock: createdProduct!.stock,
        status: createdProduct!.status,
      },
      req,
    })

    // The public catalogue lists/details are now stale; drop them. No-op when
    // caching is disabled.
    await invalidateCatalogCaches()

    logger.info({ productId: createdProduct!.id, sku: createdProduct!.sku }, 'Product created successfully')
    return this.formatAdminProduct(createdProduct)
  }

  /**
   * Update an existing product with price change auditing, inventory synchronization,
   * and partial attribute modifications.
   */
  public static async updateProduct(
    id: string,
    data: UpdateProductInput,
    actorId?: string,
    req?: Request
  ) {
    const existing = await prisma.product.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: { inventory: true },
    })

    if (!existing) {
      throw new NotFoundError(`Product '${id}' not found`)
    }

    // 1. Validate Category if provided
    let categoryId = existing.categoryId
    if (data.categorySlug) {
      const cat = await prisma.category.findUnique({
        where: { slug: data.categorySlug.toLowerCase() },
      })
      if (!cat) throw new BadRequestError(`Category '${data.categorySlug}' not found`)
      categoryId = cat.id
    } else if (data.categoryId) {
      const cat = await prisma.category.findUnique({
        where: { id: data.categoryId },
      })
      if (!cat) throw new BadRequestError(`Category '${data.categoryId}' not found`)
      categoryId = cat.id
    }

    // 2. Validate SKU uniqueness if modified
    if (data.sku && data.sku.trim() !== existing.sku) {
      const duplicateSku = await prisma.product.findUnique({
        where: { sku: data.sku.trim() },
      })
      if (duplicateSku && duplicateSku.id !== existing.id) {
        throw new ConflictError(`Product with SKU '${data.sku}' already exists`)
      }
    }

    // 3. Validate Slug uniqueness if modified
    if (data.slug && data.slug.toLowerCase() !== existing.slug) {
      const duplicateSlug = await prisma.product.findUnique({
        where: { slug: data.slug.toLowerCase() },
      })
      if (duplicateSlug && duplicateSlug.id !== existing.id) {
        throw new ConflictError(`Product with slug '${data.slug}' already exists`)
      }
    }

    // 4. Exact Decimal Pricing & MRP Validation
    const proposedPrice = data.price !== undefined ? new Prisma.Decimal(data.price) : existing.price
    const proposedMrp = data.mrp !== undefined ? new Prisma.Decimal(data.mrp) : existing.mrp

    if (proposedPrice.greaterThan(proposedMrp)) {
      throw new BadRequestError('Selling price cannot exceed the original MRP price')
    }

    const priceChanged = !proposedPrice.equals(existing.price) || !proposedMrp.equals(existing.mrp)
    // An explicit discount always wins. Otherwise the discount is only derived
    // from mrp - price when the money actually moved: an unrelated edit (name,
    // stock, images, ...) must not silently discard a discount the operator set
    // by hand and replace it with the list-price difference.
    const proposedDiscount = data.discount !== undefined
      ? new Prisma.Decimal(data.discount)
      : priceChanged
        ? proposedMrp.minus(proposedPrice)
        : existing.discount

    // 5. Stock & Inventory Synchronization
    const newStock = data.stock !== undefined ? data.stock : existing.stock
    const invStatus: InventoryStatus = newStock > 10 ? InventoryStatus.IN_STOCK : newStock > 0 ? InventoryStatus.LOW_STOCK : InventoryStatus.OUT_OF_STOCK

    // Backward compatibility for `active` boolean
    const isActive = data.isActive !== undefined ? data.isActive : data.active !== undefined ? data.active : existing.isActive

    // Verify and canonicalise a supplied gallery *before* the destructive
    // delete-all/recreate below. Object-form entries carrying an `s3Key` go
    // through the same verification as `addImage` — the key must resolve to an
    // object under this product's prefix, and `imageUrl` is recomputed from the
    // verified key rather than trusting the supplied URL. Verification failures
    // are caller errors and surface as a 400.
    const resolvedImages =
      data.images === undefined ? undefined : await this.resolveGalleryImages(existing.id, data.images)

    const updated = await prisma.$transaction(async (tx) => {
      const prod = await tx.product.update({
        where: { id: existing.id },
        data: {
          name: data.name !== undefined ? data.name.trim() : undefined,
          slug: data.slug !== undefined ? data.slug.toLowerCase() : undefined,
          sku: data.sku !== undefined ? data.sku.trim() : undefined,
          categoryId,
          shortDescription: data.shortDescription !== undefined ? data.shortDescription : undefined,
          description: data.description !== undefined ? data.description : undefined,
          price: proposedPrice,
          mrp: proposedMrp,
          discount: proposedDiscount,
          currency: data.currency !== undefined ? data.currency : undefined,
          unit: data.unit !== undefined ? data.unit.trim() : undefined,
          netWeight: data.netWeight !== undefined ? new Prisma.Decimal(data.netWeight) : undefined,
          stock: newStock,
          rating: data.rating !== undefined ? new Prisma.Decimal(data.rating) : undefined,
          reviewCount: data.reviewCount !== undefined ? data.reviewCount : undefined,
          tags: data.tags !== undefined ? data.tags : undefined,
          ingredients: data.ingredients !== undefined ? data.ingredients : undefined,
          allergens: data.allergens !== undefined ? data.allergens : undefined,
          shelfLife: data.shelfLife !== undefined ? data.shelfLife : undefined,
          storage: data.storage !== undefined ? data.storage : undefined,
          nutrition: data.nutrition !== undefined ? data.nutrition : undefined,
          specifications: data.specifications !== undefined ? data.specifications : undefined,
          isOrganic: data.isOrganic !== undefined ? data.isOrganic : undefined,
          isBestSeller: data.isBestSeller !== undefined ? data.isBestSeller : undefined,
          isNew: data.isNew !== undefined ? data.isNew : undefined,
          isFeatured: data.isFeatured !== undefined ? data.isFeatured : undefined,
          isActive,
          status: data.status !== undefined ? data.status : undefined,
          metaTitle: data.metaTitle !== undefined ? data.metaTitle : undefined,
          metaDescription: data.metaDescription !== undefined ? data.metaDescription : undefined,
          metaKeywords: data.metaKeywords !== undefined ? data.metaKeywords : undefined,
        },
        include: {
          category: true,
          images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
          inventory: true,
        },
      })

      // Sync inventory record
      if (data.stock !== undefined) {
        const invRecord = await tx.inventory.upsert({
          where: { productId: existing.id },
          create: {
            productId: existing.id,
            availableQuantity: newStock,
            status: invStatus,
            reorderThreshold: 10,
          },
          update: {
            availableQuantity: newStock,
            status: invStatus,
          },
        })

        if (existing.stock !== newStock) {
          await tx.inventoryLog.create({
            data: {
              inventoryId: invRecord.id,
              productId: existing.id,
              actorId: actorId || null,
              actorEmail: req?.user?.email || null,
              operation: 'MANUAL_ADJUSTMENT',
              previousQuantity: existing.stock,
              newQuantity: newStock,
              quantityChange: newStock - existing.stock,
              previousReserved: invRecord.reservedQuantity,
              newReserved: invRecord.reservedQuantity,
              reason: 'Direct product catalog stock edit',
            },
          })
        }
        prod.inventory = invRecord
      }

      // Sync gallery images when the caller supplied an `images` array. Without
      // this, an admin edit of the primary/gallery images was silently dropped:
      // `data.images` was validated then never written.
      if (resolvedImages !== undefined) {
        await tx.productImage.deleteMany({ where: { productId: existing.id } })

        if (resolvedImages.length > 0) {
          await tx.productImage.createMany({
            data: resolvedImages.map((img, index: number) => ({
              productId: existing.id,
              imageUrl: img.imageUrl,
              s3Key: img.s3Key,
              altText: img.altText,
              displayOrder: img.displayOrder ?? index,
              isPrimary: img.isPrimary ?? index === 0,
            })),
          })
        }

        prod.images = await tx.productImage.findMany({
          where: { productId: existing.id },
          orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
        })
      }

      return prod
    }, { timeout: 25000, maxWait: 20000 })

    // 6. Record Audit Logs
    if (priceChanged) {
      await AuditService.record({
        action: 'PRODUCT_PRICE_CHANGED',
        entity: 'Product',
        entityId: updated.id,
        actorId,
        metadata: {
          old: { price: existing.price.toString(), mrp: existing.mrp.toString() },
          new: { price: proposedPrice.toString(), mrp: proposedMrp.toString() },
        },
        req,
      })
    }

    await AuditService.record({
      action: 'PRODUCT_UPDATED',
      entity: 'Product',
      entityId: updated.id,
      actorId,
      metadata: {
        old: { name: existing.name, sku: existing.sku, status: existing.status, stock: existing.stock },
        new: { name: updated.name, sku: updated.sku, status: updated.status, stock: updated.stock },
      },
      req,
    })

    await invalidateCatalogCaches()

    logger.info({ productId: updated.id, name: updated.name }, 'Product updated successfully')
    return this.formatAdminProduct(updated)
  }

  /**
   * Delete or archive product safely.
   * Products referenced by historical orders are soft-deleted / archived to protect financial audit trails.
   */
  public static async deleteProduct(
    id: string,
    actorId?: string,
    req?: Request
  ) {
    const existing = await prisma.product.findFirst({
      where: { OR: [{ id }, { slug: id }] },
    })

    if (!existing) {
      throw new NotFoundError(`Product '${id}' not found`)
    }

    // Check historical orders
    const historicalOrderCount = await prisma.orderItem.count({
      where: { productId: existing.id },
    })

    const isArchivedDueToOrders = historicalOrderCount > 0

    // Always perform soft-delete / archiving to preserve orders, carts, and invoices
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        isActive: false,
        status: ProductStatus.ARCHIVED,
      },
    })

    await AuditService.record({
      action: 'PRODUCT_ARCHIVED',
      entity: 'Product',
      entityId: existing.id,
      actorId,
      metadata: {
        name: existing.name,
        reason: isArchivedDueToOrders ? 'Archived due to historical order references' : 'Archived by administrator',
      },
      req,
    })

    await invalidateCatalogCaches()

    logger.info(
      { productId: existing.id, historicalOrders: historicalOrderCount },
      'Product archived / soft-deleted successfully'
    )

    return {
      success: true,
      message: isArchivedDueToOrders
        ? 'Product has been archived to preserve historical order records.'
        : 'Product has been successfully deleted/archived.',
    }
  }

  // ==========================================
  // S3 IMAGE MANAGEMENT
  // ==========================================

  /**
   * Generate pre-signed PUT URL for direct browser-to-S3 upload.
   *
   * The object key extension is derived from the validated MIME type, and the
   * declared size is bounded here. `addImage` re-verifies the stored object.
   */
  public static async generateImagePresignedUrl(productId: string, data: PresignedUrlRequestInput) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    })
    if (!product) {
      throw new NotFoundError(`Product '${productId}' not found`)
    }

    return S3Service.generatePresignedUploadUrl(productId, data.contentType, data.sizeBytes)
  }

  /**
   * Resolves a validated `images` payload into rows ready for insertion.
   *
   * String entries are direct URLs with no backing object and are stored as-is,
   * matching `createProduct`. Object entries carrying an `s3Key` are verified
   * exactly like `addImage` (key must belong to this product, real bytes must
   * match the declared image type) and `imageUrl` is recomputed from the
   * verified key rather than trusting the supplied URL — otherwise an admin
   * could point a gallery row at an arbitrary external origin while presenting
   * a valid-looking key. Verification failures are caller errors (400).
   */
  private static async resolveGalleryImages(
    productId: string,
    images: NonNullable<UpdateProductInput['images']>
  ) {
    const resolved: Array<{
      imageUrl: string
      s3Key?: string
      altText?: string
      isPrimary?: boolean
      displayOrder?: number
    }> = []

    for (const img of images) {
      if (typeof img === 'string') {
        resolved.push({ imageUrl: img })
        continue
      }

      const s3Key = img.s3Key?.trim()
      if (!s3Key) {
        resolved.push({
          imageUrl: img.imageUrl,
          s3Key: undefined,
          altText: img.altText,
          isPrimary: img.isPrimary,
          displayOrder: img.displayOrder,
        })
        continue
      }

      try {
        await S3Service.verifyUploadedObject(s3Key, { expectedProductId: productId })
      } catch (error) {
        throw new BadRequestError(
          error instanceof Error ? error.message : 'Uploaded image could not be verified.'
        )
      }

      resolved.push({
        imageUrl: S3Service.buildPublicUrl(s3Key),
        s3Key,
        altText: img.altText,
        isPrimary: img.isPrimary,
        displayOrder: img.displayOrder,
      })
    }

    return resolved
  }

  /**
   * Attach an uploaded image to a product.
   * If isPrimary is set to true, any previous primary image is safely demoted.
   *
   * SECURITY: when an S3 key is supplied the stored object is re-validated —
   * not just its declared metadata, but its actual leading bytes — and the key
   * must belong to this product. A presigned PUT lets the browser write the
   * bytes directly, so without this check any object already in the bucket
   * could be attached as product media regardless of its real type or size,
   * and an image minted for product A could be re-attached to product B.
   *
   * `imageUrl` is always recomputed from the verified key so a caller cannot
   * point a product row at an attacker-controlled external origin.
   */
  public static async addImage(
    productId: string,
    data: AddProductImageInput,
    actorId?: string,
    req?: Request
  ) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { images: true },
    })
    if (!product) {
      throw new NotFoundError(`Product '${productId}' not found`)
    }

    if (!data.s3Key) {
      throw new BadRequestError(
        'imageUrl cannot be supplied directly. Upload the file first and pass the returned s3Key.'
      )
    }

    const s3Key = String(data.s3Key).trim()

    // A key can only back a single gallery row. Allowing the same object to be
    // attached twice produced duplicate entries pointing at one S3 object; when
    // one was deleted the S3 file was removed and the other entry was left with
    // a dangling URL.
    if (product.images.some((img) => img.s3Key === s3Key)) {
      throw new ConflictError('This image has already been attached to the product.')
    }

    // Verification throws on any mismatch (wrong product, disallowed type/size, or
    // bytes that do not match the declared image type). Those are all caller
    // errors, so translate them to a 400 rather than letting a bare `Error`
    // surface as an opaque 500.
    try {
      await S3Service.verifyUploadedObject(s3Key, {
        expectedProductId: productId,
      })
    } catch (error) {
      const removed = await S3Service.deleteFile(s3Key).catch(() => false)
      if (!removed) {
        logger.error({ productId, s3Key }, 'Failed to clean up an unverified product image upload')
      }
      throw new BadRequestError(
        error instanceof Error ? error.message : 'Uploaded image could not be verified.'
      )
    }

    const imageUrl = S3Service.buildPublicUrl(s3Key)

    // Determine primary status: if explicitly set or if it's the very first image
    const shouldBePrimary = data.isPrimary || product.images.length === 0
    const displayOrder = data.displayOrder ?? product.images.length

    let createdImage
    try {
      createdImage = await prisma.$transaction(async (tx) => {
        if (shouldBePrimary) {
          await tx.productImage.updateMany({
            where: { productId },
            data: { isPrimary: false },
          })
        }

        return tx.productImage.create({
          data: {
            productId,
            imageUrl,
            s3Key,
            altText: data.altText,
            isPrimary: shouldBePrimary,
            displayOrder,
          },
        })
      }, { timeout: 25000, maxWait: 20000 })
    } catch (error) {
      // The pre-check above is only a fast path: two concurrent attaches of the
      // same key both read the gallery before either inserts, so the unique
      // index on (productId, s3Key) is what actually decides the winner. The
      // loser must NOT delete the object here — it is still referenced by the
      // winning row — so map the conflict to 409 before the compensation path.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('This image has already been attached to the product.')
      }

      const removed = await S3Service.deleteFile(s3Key).catch(() => false)
      if (!removed) {
        logger.error({ productId, s3Key }, 'Failed to clean up product image after the database attach failed')
      }
      throw error
    }

    await AuditService.record({
      action: 'PRODUCT_IMAGE_ADDED',
      entity: 'ProductImage',
      entityId: createdImage.id,
      actorId,
      metadata: { productId, imageUrl: createdImage.imageUrl, s3Key: createdImage.s3Key, isPrimary: createdImage.isPrimary },
      req,
    })

    await invalidateCatalogCaches()

    return createdImage
  }

  /**
   * Set primary image for a product transactionally.
   */
  public static async setPrimaryImage(
    productId: string,
    imageId: string,
    actorId?: string,
    req?: Request
  ) {
    const targetImage = await prisma.productImage.findFirst({
      where: { id: imageId, productId },
    })
    if (!targetImage) {
      throw new NotFoundError(`Image '${imageId}' not found for product '${productId}'`)
    }

    await prisma.$transaction([
      prisma.productImage.updateMany({
        where: { productId },
        data: { isPrimary: false },
      }),
      prisma.productImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ])

    await AuditService.record({
      action: 'PRODUCT_IMAGE_PRIMARY_CHANGED',
      entity: 'ProductImage',
      entityId: imageId,
      actorId,
      metadata: { productId, primaryImageId: imageId },
      req,
    })

    await invalidateCatalogCaches()

    return prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
    })
  }

  /**
   * Reorder product gallery images.
   */
  public static async reorderImages(
    productId: string,
    data: ReorderImagesInput,
    actorId?: string,
    req?: Request
  ) {
    const imageIds = data.images.map((img) => img.imageId)

    // Verify all images belong to the product
    const count = await prisma.productImage.count({
      where: { id: { in: imageIds }, productId },
    })
    if (count !== imageIds.length) {
      throw new BadRequestError('One or more image IDs do not belong to this product')
    }

    await prisma.$transaction(
      data.images.map((item) =>
        prisma.productImage.update({
          where: { id: item.imageId },
          data: { displayOrder: item.displayOrder },
        })
      )
    )

    await AuditService.record({
      action: 'PRODUCT_IMAGES_REORDERED',
      entity: 'Product',
      entityId: productId,
      actorId,
      metadata: { orders: data.images },
      req,
    })

    await invalidateCatalogCaches()

    return prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }],
    })
  }

  /**
   * Delete an image from PostgreSQL and Amazon S3.
   * If the primary image is removed, promotes the next image to primary.
   */
  public static async deleteImage(
    productId: string,
    imageId: string,
    actorId?: string,
    req?: Request
  ) {
    const targetImage = await prisma.productImage.findFirst({
      where: { id: imageId, productId },
    })
    if (!targetImage) {
      throw new NotFoundError(`Image '${imageId}' not found for product '${productId}'`)
    }

    // 1. Delete from Amazon S3 if s3Key exists
    if (targetImage.s3Key) {
      try {
        const deleted = await S3Service.deleteFile(targetImage.s3Key)
        if (!deleted) throw new Error('S3 object deletion was not confirmed')
      } catch (err: any) {
        logger.error({ error: err.message, s3Key: targetImage.s3Key }, 'S3 deletion failed; preserving the product image record')
        throw new ServiceUnavailableError('Image storage is unavailable; the image was not removed. Please retry.')
      }
    }

    // 2. Transactionally remove image and promote next image if primary was deleted
    await prisma.$transaction(async (tx) => {
      await tx.productImage.delete({
        where: { id: imageId },
      })

      if (targetImage.isPrimary) {
        const nextImage = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { displayOrder: 'asc' },
        })
        if (nextImage) {
          await tx.productImage.update({
            where: { id: nextImage.id },
            data: { isPrimary: true },
          })
        }
      }
    }, { timeout: 25000, maxWait: 20000 })

    // 3. Record Audit Event
    await AuditService.record({
      action: 'PRODUCT_IMAGE_DELETED',
      entity: 'ProductImage',
      entityId: imageId,
      actorId,
      metadata: { productId, imageUrl: targetImage.imageUrl, s3Key: targetImage.s3Key },
      req,
    })

    await invalidateCatalogCaches()

    return { success: true, message: 'Image deleted successfully' }
  }
}
