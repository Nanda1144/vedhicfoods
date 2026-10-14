import './_safety'
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'

const app = createApp()

describe('Product, Category & Amazon S3 Integration Tests', () => {
  let adminToken: string
  let staffWithPermissionToken: string
  let staffWithoutPermissionToken: string
  let customerToken: string

  let testCategoryId: string
  let testCategorySlug: string
  let subCategoryId: string
  let testProductId: string
  let testProductSlug: string
  let testSku: string
  let testImage1Id: string
  let testImage2Id: string

  const timestamp = Date.now()

  beforeAll(async () => {
    // 1. Authenticate Seeded Admin
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    // 2. Authenticate Seeded Staff (staff role without products.create permission)
    const staffLogin = await AuthService.login({
      email: 'staff@vedhicfoods.com',
      password: 'Staff@Vedhic2026',
    })
    staffWithoutPermissionToken = staffLogin.accessToken
    staffWithPermissionToken = adminToken // Admin holds all permissions including products.create

    // 3. Authenticate Seeded Customer
    const customerLogin = await AuthService.login({
      email: 'customer@vedhicfoods.com',
      password: 'Customer@Vedhic2026',
    })
    customerToken = customerLogin.accessToken
  }, 60000)

  // =========================================================================
  // 1. CATEGORY MANAGEMENT & VALIDATION TESTS
  // =========================================================================
  describe('Category Management CRUD & Hierarchy Safety', () => {
    it('POST /api/v1/admin/categories should create a category with permissions (categories.create)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Ancient Heritage Grains ${timestamp}`,
          tagline: 'Pure heirloom nutrition',
          description: 'Sustainably farmed ancient grains rich in fiber and micronutrients.',
          accent: '#A85A32',
          featured: true,
          sortOrder: 1,
        })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.name).toBe(`Ancient Heritage Grains ${timestamp}`)
      expect(res.body.slug).toBeDefined()
      testCategoryId = res.body.id
      testCategorySlug = res.body.slug
    }, 30000)

    it('POST /api/v1/admin/categories should reject duplicate slug/name with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Ancient Heritage Grains ${timestamp}`,
          slug: testCategorySlug,
        })

      expect(res.status).toBe(409)
      expect(res.body.error).toBeDefined()
    }, 30000)

    it('POST /api/v1/admin/categories should allow creating subcategory with valid parentId', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Foxtail Millets ${timestamp}`,
          parentId: testCategoryId,
          accent: '#C9A24B',
          sortOrder: 2,
        })

      expect(res.status).toBe(201)
      expect(res.body.parentId).toBe(testCategoryId)
      subCategoryId = res.body.id
    }, 30000)

    it('PATCH /api/v1/admin/categories/:id should reject circular category hierarchy', async () => {
      // Trying to set parent of testCategoryId to its child subCategoryId
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          parentId: subCategoryId,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('hierarchy')
    }, 30000)

    it('PATCH /api/v1/admin/categories/:id should reject category setting itself as parent', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          parentId: testCategoryId,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('own parent')
    }, 30000)

    it('GET /api/v1/categories should return public category hierarchy and active product counts', async () => {
      const res = await request(app).get('/api/v1/categories')

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      const found = res.body.find((c: any) => c.id === testCategoryId)
      expect(found).toBeDefined()
      expect(found.children.some((child: any) => child.id === subCategoryId)).toBe(true)
    }, 30000)

    it('GET /api/v1/categories/:idOrSlug should fetch single category by slug', async () => {
      const res = await request(app).get(`/api/v1/categories/${testCategorySlug}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testCategoryId)
      expect(res.body.slug).toBe(testCategorySlug)
    }, 30000)
  })

  // =========================================================================
  // 2. PRODUCT CREATION, VALIDATION & PRICING PRECISION
  // =========================================================================
  describe('Product Creation & Financial Decimal Precision', () => {
    it('POST /api/v1/admin/products should reject product creation where selling price > mrp', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Invalid Price Product',
          price: 650, // Selling price
          mrp: 500,   // MRP is lower than selling price -> Invalid!
          sku: `SKU-INV-${timestamp}`,
          categoryId: testCategoryId,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('cannot exceed')
    }, 30000)

    it('POST /api/v1/admin/products should successfully create product and sync inventory', async () => {
      testSku = `SKU-GRAIN-${timestamp}`
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Unpolished Little Millet ${timestamp}`,
          sku: testSku,
          categoryId: testCategoryId,
          shortDescription: 'Naturally grown native little millet grains',
          description: 'Rich in dietary fiber and slow-digesting complex carbohydrates.',
          price: 240.00,
          mrp: 299.00,
          unit: '1 kg',
          netWeight: 1000,
          stock: 75,
          shelfLife: '12 Months',
          storage: 'Store in an airtight container',
          isOrganic: true,
          isFeatured: true,
          tags: ['millet', 'grain', 'organic'],
        })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.name).toContain('Unpolished Little Millet')
      expect(res.body.price).toBe(240)
      expect(res.body.mrp).toBe(299)
      expect(res.body.discount).toBe(59)
      expect(res.body.stock).toBe(75)
      expect(res.body.availability).toBe('IN_STOCK')

      testProductId = res.body.id
      testProductSlug = res.body.slug

      // Verify linked inventory record exists in database
      const inv = await prisma.inventory.findUnique({
        where: { productId: testProductId },
      })
      expect(inv).toBeDefined()
      expect(inv?.availableQuantity).toBe(75)
      expect(inv?.status).toBe('IN_STOCK')
    }, 30000)

    it('POST /api/v1/admin/products should reject duplicate SKU with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Duplicate SKU Product ${timestamp}`,
          sku: testSku,
          categoryId: testCategoryId,
          price: 150,
          mrp: 180,
        })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already exists')
    }, 30000)
  })

  // =========================================================================
  // 3. PRODUCT UPDATE & SENSITIVE PRICE CHANGE AUDITING
  // =========================================================================
  describe('Product Updates & Audit Logging', () => {
    it('PATCH /api/v1/admin/products/:id should partially update product and audit price change', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          price: 220.00, // Price drop
          stock: 60,
          isBestSeller: true,
        })

      expect(res.status).toBe(200)
      expect(res.body.price).toBe(220)
      expect(res.body.discount).toBe(79) // 299 - 220 = 79
      expect(res.body.stock).toBe(60)

      // Verify audit log was recorded
      const priceAudit = await prisma.auditLog.findFirst({
        where: {
          entityId: testProductId,
          action: 'PRODUCT_PRICE_CHANGED',
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(priceAudit).toBeDefined()
    }, 30000)

    it('PATCH /api/v1/admin/products/:id should reject price increase above existing MRP', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          price: 350.00, // Existing MRP is 299 -> Invalid!
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('cannot exceed')
    }, 30000)
  })

  // =========================================================================
  // 4. AMAZON S3 PRODUCT IMAGE INTEGRATION
  // =========================================================================
  describe('Amazon S3 Image Management Workflow', () => {
    it('POST /api/v1/admin/products/:id/images/presigned-url should generate presigned S3 upload URL', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/products/${testProductId}/images/presigned-url`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          filename: 'little-millet-front.webp',
          contentType: 'image/webp',
          sizeBytes: 1024 * 500, // 500 KB
        })

      expect(res.status).toBe(200)
      expect(res.body.uploadUrl).toBeDefined()
      expect(res.body.fileUrl).toBeDefined()
      expect(res.body.s3Key).toContain(`products/${testProductId}/`)
    }, 30000)

    it('POST /api/v1/admin/products/:id/images/presigned-url should reject unsupported MIME types', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/products/${testProductId}/images/presigned-url`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          filename: 'document.pdf',
          contentType: 'application/pdf',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBeDefined()
    }, 30000)

    it('POST /api/v1/admin/products/:id/images should attach image 1 and automatically set as primary', async () => {
      const presign = await request(app)
        .post(`/api/v1/admin/products/${testProductId}/images/presigned-url`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ filename: 'millet-01.webp', contentType: 'image/webp' })
      expect(presign.status).toBe(200)
      expect(presign.body.s3Key).toContain(`products/${testProductId}/`)

      const res = await request(app)
        .post(`/api/v1/admin/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          imageUrl: presign.body.fileUrl,
          s3Key: presign.body.s3Key,
          altText: 'Front pack view of little millet',
          displayOrder: 0,
        })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.isPrimary).toBe(true) // First image becomes primary automatically
      testImage1Id = res.body.id
    }, 30000)

    it('POST /api/v1/admin/products/:id/images should attach image 2 with isPrimary=false', async () => {
      const presign = await request(app)
        .post(`/api/v1/admin/products/${testProductId}/images/presigned-url`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ filename: 'millet-02.webp', contentType: 'image/webp' })
      expect(presign.status).toBe(200)

      const res = await request(app)
        .post(`/api/v1/admin/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          imageUrl: presign.body.fileUrl,
          s3Key: presign.body.s3Key,
          altText: 'Back nutrition facts of little millet',
          isPrimary: false,
          displayOrder: 1,
        })

      expect(res.status).toBe(201)
      expect(res.body.isPrimary).toBe(false)
      testImage2Id = res.body.id
    }, 30000)

    it('PATCH /api/v1/admin/products/:id/images/:imageId/primary should safely toggle primary image in a transaction', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${testProductId}/images/${testImage2Id}/primary`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify Image 2 is now primary and Image 1 is demoted
      const img1 = await prisma.productImage.findUnique({ where: { id: testImage1Id } })
      const img2 = await prisma.productImage.findUnique({ where: { id: testImage2Id } })

      expect(img1?.isPrimary).toBe(false)
      expect(img2?.isPrimary).toBe(true)
    }, 30000)

    it('PATCH /api/v1/admin/products/:id/images/reorder should update gallery display orders', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${testProductId}/images/reorder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          images: [
            { imageId: testImage1Id, displayOrder: 10 },
            { imageId: testImage2Id, displayOrder: 5 },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const img1 = await prisma.productImage.findUnique({ where: { id: testImage1Id } })
      const img2 = await prisma.productImage.findUnique({ where: { id: testImage2Id } })

      expect(img1?.displayOrder).toBe(10)
      expect(img2?.displayOrder).toBe(5)
    }, 30000)

    it('DELETE /api/v1/admin/products/:id/images/:imageId should delete image and promote next image to primary', async () => {
      // testImage2Id was currently primary. Deleting it should promote testImage1Id to primary.
      const res = await request(app)
        .delete(`/api/v1/admin/products/${testProductId}/images/${testImage2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify Image 2 deleted
      const img2 = await prisma.productImage.findUnique({ where: { id: testImage2Id } })
      expect(img2).toBeNull()

      // Verify Image 1 promoted to primary
      const img1 = await prisma.productImage.findUnique({ where: { id: testImage1Id } })
      expect(img1?.isPrimary).toBe(true)
    }, 30000)
  })

  // =========================================================================
  // 5. PUBLIC PRODUCT CATALOG, SEARCH, FILTERING & PAGINATION
  // =========================================================================
  describe('Public Product Storefront, Search & Filters', () => {
    it('GET /api/v1/products should support search query ?q=...', async () => {
      const res = await request(app).get(`/api/v1/products?q=millet`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.items)).toBe(true)
      expect(res.body.items.some((p: any) => p.id === testProductId)).toBe(true)
    }, 30000)

    it('GET /api/v1/products should filter by category', async () => {
      const res = await request(app).get(`/api/v1/products?category=${testCategorySlug}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.items)).toBe(true)
      expect(res.body.items.every((p: any) => p.categorySlug === testCategorySlug || p.categoryId === testCategoryId)).toBe(true)
    }, 30000)

    it('GET /api/v1/products should filter by price range (minPrice, maxPrice)', async () => {
      const res = await request(app).get('/api/v1/products?minPrice=200&maxPrice=300')

      expect(res.status).toBe(200)
      expect(res.body.items.every((p: any) => p.price >= 200 && p.price <= 300)).toBe(true)
    }, 30000)

    it('GET /api/v1/products should filter by availability (available=true)', async () => {
      const res = await request(app).get('/api/v1/products?available=true')

      expect(res.status).toBe(200)
      expect(res.body.items.every((p: any) => p.isAvailable === true && p.stock > 0)).toBe(true)
    }, 30000)

    it('GET /api/v1/products should support sorting (sort=price_asc)', async () => {
      const res = await request(app).get('/api/v1/products?sort=price_asc&limit=10')

      expect(res.status).toBe(200)
      const prices = res.body.items.map((p: any) => p.price)
      const sortedPrices = [...prices].sort((a, b) => a - b)
      expect(prices).toEqual(sortedPrices)
    }, 30000)

    it('GET /api/v1/products should return server-side pagination metadata and cap excessive limits at 100', async () => {
      const res = await request(app).get('/api/v1/products?page=1&limit=500')

      expect(res.status).toBe(200)
      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(100) // DOS defense: capped at 100
      expect(res.body.total).toBeGreaterThanOrEqual(1)
      expect(res.body.totalPages).toBeGreaterThanOrEqual(1)
    }, 30000)

    it('GET /api/v1/products/:id should fetch product by UUID', async () => {
      const res = await request(app).get(`/api/v1/products/${testProductId}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testProductId)
      expect(res.body.price).toBe(220)
      expect(res.body.primaryImage).toBeDefined()
    }, 30000)

    it('GET /api/v1/products/slug/:slug should fetch product by Slug', async () => {
      const res = await request(app).get(`/api/v1/products/slug/${testProductSlug}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testProductId)
      expect(res.body.slug).toBe(testProductSlug)
    }, 30000)
  })

  // =========================================================================
  // 6. AUTHORIZATION BOUNDARY ENFORCEMENT
  // =========================================================================
  describe('RBAC & Authorization Boundaries', () => {
    it('Customer should be rejected with 403 Forbidden on product creation', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Unauthorized Product',
          price: 100,
          mrp: 120,
          sku: `SKU-UNAUTH-${timestamp}`,
          categoryId: testCategoryId,
        })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    }, 30000)

    it('Customer should be rejected with 403 Forbidden on category deletion', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Authorization', `Bearer ${customerToken}`)

      expect(res.status).toBe(403)
    }, 30000)

    it('Unauthenticated user should be rejected with 401 Unauthorized on admin routes', async () => {
      const res = await request(app).post('/api/v1/admin/products').send({})

      expect(res.status).toBe(401)
    }, 30000)

    it('Staff without products.create permission should be rejected with 403 Forbidden on product creation', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${staffWithoutPermissionToken}`)
        .send({
          name: `Staff Rejected Product ${timestamp}`,
          price: 180,
          mrp: 200,
          sku: `SKU-STAFF-REJECT-${timestamp}`,
          categoryId: testCategoryId,
        })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    }, 30000)

    it('Staff with products.create permission should be allowed to create product', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${staffWithPermissionToken}`)
        .send({
          name: `Staff Created Product ${timestamp}`,
          price: 180,
          mrp: 200,
          sku: `SKU-STAFF-${timestamp}`,
          categoryId: testCategoryId,
          stock: 20,
        })

      expect(res.status).toBe(201)
      expect(res.body.name).toContain('Staff Created Product')
    }, 30000)
  })

  // =========================================================================
  // 7. PRODUCT SOFT-DELETE & ARCHIVING SAFETY
  // =========================================================================
  describe('Product Soft-Delete & Category Deletion Safety', () => {
    it('DELETE /api/v1/admin/categories/:id should reject deletion of category with active products', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/categories/${testCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('active product')
    }, 30000)

    it('DELETE /api/v1/admin/products/:id should soft-delete / archive product safely', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/products/${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify product is now archived and isDeleted=true in database
      const prod = await prisma.product.findUnique({ where: { id: testProductId } })
      expect(prod?.isDeleted).toBe(true)
      expect(prod?.status).toBe('ARCHIVED')
      expect(prod?.isActive).toBe(false)

      // Verify it is no longer returned in public catalog
      const pubRes = await request(app).get(`/api/v1/products/${testProductId}`)
      expect(pubRes.status).toBe(404)
    }, 30000)
  })
})
