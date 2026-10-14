import { z } from 'zod'
import { ProductStatus } from '@prisma/client'

// ==========================================
// CATEGORY SCHEMAS & TYPES
// ==========================================

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Category name must be at least 2 characters').max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must consist of lowercase letters, numbers, and single hyphens')
    .optional(),
  tagline: z.string().trim().max(255).optional(),
  description: z.string().trim().optional(),
  image: z.string().trim().optional(),
  accent: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Accent must be a valid hex color code (e.g. #C9A24B)')
    .default('#C9A24B'),
  featured: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  parentId: z.string().uuid('Invalid parent category UUID').nullable().optional(),
})

export const updateCategorySchema = createCategorySchema.partial()

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>

export interface CategoryHierarchyResponse {
  id: string
  slug: string
  name: string
  tagline?: string | null
  description?: string | null
  image?: string | null
  accent: string
  featured: boolean
  sortOrder: number
  isActive: boolean
  parentId?: string | null
  parent?: { id: string; name: string; slug: string } | null
  children?: CategoryHierarchyResponse[]
  productCount?: number
  createdAt: string
  updatedAt: string
}

// ==========================================
// PRODUCT SCHEMAS & TYPES
// ==========================================

export const createProductSchema = z
  .object({
    name: z.string().trim().min(2, 'Product name must be at least 2 characters').max(200),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must consist of lowercase letters, numbers, and single hyphens')
      .optional(),
    sku: z.string().trim().min(3, 'SKU must be at least 3 characters').max(100),
    categoryId: z.string().uuid('Invalid category UUID').optional(),
    categorySlug: z.string().trim().optional(),
    shortDescription: z.string().trim().max(500).optional(),
    description: z.string().trim().optional(),
    price: z.coerce.number().positive('Selling price must be greater than zero'),
    mrp: z.coerce.number().positive('MRP must be greater than zero'),
    discount: z.coerce.number().min(0).optional(),
    currency: z.string().default('INR'),
    unit: z.string().trim().default('piece'),
    netWeight: z.coerce.number().min(0).default(0),
    stock: z.coerce.number().int().min(0).default(0),
    rating: z.coerce.number().min(0).max(5).default(4.8),
    reviewCount: z.coerce.number().int().min(0).default(0),
    tags: z.array(z.string().trim()).default([]),
    ingredients: z.array(z.string().trim()).default([]),
    allergens: z.array(z.string().trim()).default([]),
    shelfLife: z.string().trim().default('6 Months'),
    storage: z.string().trim().default('Store in a cool, dry place'),
    nutrition: z.array(z.any()).default([]),
    specifications: z.array(z.any()).default([]),
    isOrganic: z.boolean().default(true),
    isBestSeller: z.boolean().default(false),
    isNew: z.boolean().default(false),
    isFeatured: z.boolean().default(false),
    isActive: z.boolean().default(true),
    status: z.nativeEnum(ProductStatus).default(ProductStatus.PUBLISHED),
    metaTitle: z.string().trim().max(200).optional(),
    metaDescription: z.string().trim().max(500).optional(),
    metaKeywords: z.array(z.string().trim()).default([]),
    images: z
      .array(
        z.union([
          z.string().url(),
          z.object({
            imageUrl: z.string().url(),
            s3Key: z.string().optional(),
            altText: z.string().optional(),
            isPrimary: z.boolean().optional(),
            displayOrder: z.number().int().min(0).optional(),
          }),
        ])
      )
      .optional(),
  })
  .refine(
    (data) => data.price <= data.mrp,
    {
      message: 'Selling price cannot exceed the original MRP price',
      path: ['price'],
    }
  )

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    sku: z.string().trim().min(3).max(100).optional(),
    categoryId: z.string().uuid().optional(),
    categorySlug: z.string().trim().optional(),
    shortDescription: z.string().trim().max(500).optional(),
    description: z.string().trim().optional(),
    price: z.coerce.number().positive().optional(),
    mrp: z.coerce.number().positive().optional(),
    discount: z.coerce.number().min(0).optional(),
    currency: z.string().optional(),
    unit: z.string().trim().optional(),
    netWeight: z.coerce.number().min(0).optional(),
    stock: z.coerce.number().int().min(0).optional(),
    rating: z.coerce.number().min(0).max(5).optional(),
    reviewCount: z.coerce.number().int().min(0).optional(),
    tags: z.array(z.string().trim()).optional(),
    ingredients: z.array(z.string().trim()).optional(),
    allergens: z.array(z.string().trim()).optional(),
    shelfLife: z.string().trim().optional(),
    storage: z.string().trim().optional(),
    nutrition: z.array(z.any()).optional(),
    specifications: z.array(z.any()).optional(),
    isOrganic: z.boolean().optional(),
    isBestSeller: z.boolean().optional(),
    isNew: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    isActive: z.boolean().optional(),
    active: z.boolean().optional(), // For backward compatibility with legacy calls
    status: z.nativeEnum(ProductStatus).optional(),
    metaTitle: z.string().trim().max(200).optional(),
    metaDescription: z.string().trim().max(500).optional(),
    metaKeywords: z.array(z.string().trim()).optional(),
    images: z.array(z.string().url()).optional(),
  })
  .refine(
    (data) => {
      if (data.price !== undefined && data.mrp !== undefined) {
        return data.price <= data.mrp
      }
      return true
    },
    {
      message: 'Selling price cannot exceed the original MRP price',
      path: ['price'],
    }
  )

export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20).transform((val) => Math.min(100, val)),
  per_page: z.coerce.number().int().min(1).optional().transform((val) => (val !== undefined ? Math.min(100, val) : undefined)),
  q: z.string().trim().optional(),
  search: z.string().trim().optional(), // Backward compatibility
  category: z.string().trim().optional(),
  category_slug: z.string().trim().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  min_price: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  available: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true
        if (val.toLowerCase() === 'false') return false
      }
      return val
    }, z.boolean())
    .optional(),
  featured: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true
        if (val.toLowerCase() === 'false') return false
      }
      return val
    }, z.boolean())
    .optional(),
  // Boolean query flags arrive as strings over HTTP, so each one needs the same
  // 'true'/'false' coercion as `featured`. Declaring them explicitly also stops
  // Zod from silently stripping them: an unrecognised key is dropped, so a
  // misspelled filter name produces an unfiltered 200 response instead of an
  // error - which reads as "the filter does nothing" and is very hard to spot.
  is_organic: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true
        if (val.toLowerCase() === 'false') return false
      }
      return val
    }, z.boolean())
    .optional(),
  best_seller: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true
        if (val.toLowerCase() === 'false') return false
      }
      return val
    }, z.boolean())
    .optional(),
  is_new: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true
        if (val.toLowerCase() === 'false') return false
      }
      return val
    }, z.boolean())
    .optional(),
  // Inclusive minimum average rating, e.g. `min_rating=4`.
  min_rating: z.coerce.number().min(0).max(5).optional(),
  // Comma-separated tag slugs, matched with AND (product must carry all of them).
  tags: z.string().trim().optional(),
  sort: z
    .enum([
      'price_asc',
      'price-asc',
      'price_desc',
      'price-desc',
      'rating',
      'newest',
      'bestsellers',
      'featured',
      'name_asc',
      'name-asc',
    ])
    .default('featured'),
  tag: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'ALL']).optional(),
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type ProductQueryInput = z.infer<typeof productQuerySchema>

// ==========================================
// IMAGE MANAGEMENT SCHEMAS & TYPES
// ==========================================

export const presignedUrlRequestSchema = z.object({
  /**
   * Retained for display purposes only. The S3 object key extension is derived
   * from `contentType`, never from this value, so a caller cannot mint an
   * `.html` or `.svg` key.
   */
  filename: z
    .string()
    .trim()
    .min(1, 'Filename is required')
    .max(255, 'Filename must not exceed 255 characters')
    .regex(/^[A-Za-z0-9._-]+$/, 'Filename may only contain letters, numbers, dot, dash and underscore')
    .optional(),
  contentType: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (type) => ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'].includes(type),
      'File type must be JPEG, PNG, WebP, or AVIF'
    ),
  sizeBytes: z.coerce.number().int().positive().max(5 * 1024 * 1024, 'File size must not exceed 5MB').optional(),
})

export const addProductImageSchema = z.object({
  imageUrl: z.string().url('A valid image URL is required'),
  s3Key: z.string().trim().optional(),
  altText: z.string().trim().max(255).optional(),
  isPrimary: z.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).default(0),
})

export const reorderImagesSchema = z.object({
  images: z
    .array(
      z.object({
        imageId: z.string().uuid('Invalid image UUID'),
        displayOrder: z.coerce.number().int().min(0),
      })
    )
    .min(1, 'At least one image order must be specified'),
})

export type PresignedUrlRequestInput = z.infer<typeof presignedUrlRequestSchema>
export type AddProductImageInput = z.infer<typeof addProductImageSchema>
export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>
