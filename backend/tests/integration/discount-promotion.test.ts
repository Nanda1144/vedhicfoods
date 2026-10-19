import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'

const app = createApp()

describe('Discount & Promotional Campaign Engine Integration Tests', () => {
  let adminToken: string
  let adminId: string
  let customerAToken: string
  let customerAId: string
  let customerBToken: string
  let customerBId: string

  let categoryAId: string
  let categoryBId: string
  let productAId: string
  let productBId: string
  let customerAAddressId: string
  let customerBAddressId: string

  const timestamp = Date.now()

  beforeAll(async () => {
    // 1. Admin login
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken
    adminId = adminLogin.user.id

    // 2. Register Customer A
    const emailA = `customer.disc.a.${timestamp}@test.com`
    const phoneA = `94${(timestamp % 100000000).toString().padStart(8, '0')}`
    const regA = await AuthService.register({
      fullName: 'Ananya Sharma',
      email: emailA,
      phone: phoneA,
      password: 'Customer@2026!',
    })
    customerAToken = regA.accessToken
    customerAId = regA.user.id

    // 3. Register Customer B
    const emailB = `customer.disc.b.${timestamp}@test.com`
    const phoneB = `95${((timestamp + 1) % 100000000).toString().padStart(8, '0')}`
    const regB = await AuthService.register({
      fullName: 'Bhavesh Patel',
      email: emailB,
      phone: phoneB,
      password: 'Customer@2026!',
    })
    customerBToken = regB.accessToken
    customerBId = regB.user.id

    // 4. Create Saved Addresses
    const addrA = await prisma.address.create({
      data: {
        userId: customerAId,
        fullName: 'Ananya Sharma',
        phone: phoneA,
        line1: 'Villa 101, Palm Meadows',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560066',
        isDefault: true,
      },
    })
    customerAAddressId = addrA.id

    const addrB = await prisma.address.create({
      data: {
        userId: customerBId,
        fullName: 'Bhavesh Patel',
        phone: phoneB,
        line1: 'Apt 4B, Silver Heights',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400050',
        isDefault: true,
      },
    })
    customerBAddressId = addrB.id

    // 5. Create Test Categories
    const catA = await prisma.category.create({
      data: {
        name: `Organic Spices ${timestamp}`,
        slug: `organic-spices-${timestamp}`,
        description: 'Pure Vedic Spices',
      },
    })
    categoryAId = catA.id

    const catB = await prisma.category.create({
      data: {
        name: `Herbal Infusions ${timestamp}`,
        slug: `herbal-infusions-${timestamp}`,
        description: 'Ayurvedic Herbal Blends',
      },
    })
    categoryBId = catB.id

    // 6. Create Test Products & Inventories
    const prodA = await prisma.product.create({
      data: {
        name: `Guntur Red Chilli Powder ${timestamp}`,
        slug: `guntur-chilli-${timestamp}`,
        sku: `CHILLI-${timestamp}`,
        price: 300,
        mrp: 350,
        stock: 50,
        categoryId: categoryAId,
        isActive: true,
        status: 'PUBLISHED',
        inventory: {
          create: {
            availableQuantity: 50,
            reservedQuantity: 0,
            soldQuantity: 0,
          },
        },
      },
    })
    productAId = prodA.id

    const prodB = await prisma.product.create({
      data: {
        name: `Ashwagandha Root Tea ${timestamp}`,
        slug: `ashwagandha-tea-${timestamp}`,
        sku: `ASHWA-${timestamp}`,
        price: 500,
        mrp: 600,
        stock: 50,
        categoryId: categoryBId,
        isActive: true,
        status: 'PUBLISHED',
        inventory: {
          create: {
            availableQuantity: 50,
            reservedQuantity: 0,
            soldQuantity: 0,
          },
        },
      },
    })
    productBId = prodB.id
  })

  afterAll(async () => {
    const userIds = [customerAId, customerBId].filter(Boolean) as string[]
    const productIds = [productAId, productBId].filter(Boolean) as string[]
    const categoryIds = [categoryAId, categoryBId].filter(Boolean) as string[]
    const addressIds = [customerAAddressId, customerBAddressId].filter(Boolean) as string[]

    if (userIds.length > 0) {
      await prisma.couponUsage.deleteMany({
        where: { userId: { in: userIds } },
      })
      await prisma.orderItem.deleteMany({
        where: { order: { userId: { in: userIds } } },
      })
      await prisma.delivery.deleteMany({
        where: { order: { userId: { in: userIds } } },
      })
      await prisma.payment.deleteMany({
        where: { order: { userId: { in: userIds } } },
      })
      await prisma.invoice.deleteMany({
        where: { order: { userId: { in: userIds } } },
      })
      await prisma.order.deleteMany({
        where: { userId: { in: userIds } },
      })
      await prisma.cartItem.deleteMany({
        where: { cart: { userId: { in: userIds } } },
      })
      await prisma.cart.deleteMany({
        where: { userId: { in: userIds } },
      })
    }

    if (productIds.length > 0) {
      await prisma.couponProduct.deleteMany({
        where: { productId: { in: productIds } },
      })
      await prisma.promotionProduct.deleteMany({
        where: { productId: { in: productIds } },
      })
    }

    if (categoryIds.length > 0) {
      await prisma.couponCategory.deleteMany({
        where: { categoryId: { in: categoryIds } },
      })
      await prisma.promotionCategory.deleteMany({
        where: { categoryId: { in: categoryIds } },
      })
    }

    await prisma.coupon.deleteMany({
      where: { code: { contains: `${timestamp}` } },
    })
    await prisma.promotion.deleteMany({
      where: { slug: { contains: `${timestamp}` } },
    })

    if (productIds.length > 0) {
      await prisma.inventory.deleteMany({
        where: { productId: { in: productIds } },
      })
      await prisma.product.deleteMany({
        where: { id: { in: productIds } },
      })
    }

    if (categoryIds.length > 0) {
      await prisma.category.deleteMany({
        where: { id: { in: categoryIds } },
      })
    }

    if (addressIds.length > 0) {
      await prisma.address.deleteMany({
        where: { id: { in: addressIds } },
      })
    }

    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      })
    }
  })

  // ==========================================
  // 1. ADMIN RBAC & AUTHORIZATION CHECKS
  // ==========================================
  describe('Admin RBAC & Authorization', () => {
    it('should reject unauthenticated requests to admin discount endpoints', async () => {
      const res = await request(app).get('/api/v1/admin/discounts/coupons')
      expect(res.status).toBe(401)
    })

    it('should reject customer tokens attempting to access admin coupon CRUD', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/coupons')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: `HACK${timestamp}`,
          discountType: 'PERCENTAGE',
          discountValue: 90,
        })
      expect(res.status).toBe(403)
    })

    it('should reject customer tokens attempting to create promotional campaigns', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/promotions')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          name: 'Hacked Festival',
          discountValue: 50,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
        })
      expect(res.status).toBe(403)
    })
  })

  // ==========================================
  // 2. ADMIN COUPON CRUD & AUDIT LOGGING
  // ==========================================
  describe('Admin Coupon CRUD with Audit Trails', () => {
    let createdCouponId: string
    const couponCode = `FESTIVE20_${timestamp}`

    it('POST /api/v1/admin/discounts/coupons should create a coupon and log PROMOTION_CREATED', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: couponCode,
          description: 'Festive 20% discount on organic products',
          discountType: 'PERCENTAGE',
          discountValue: 20,
          minOrderValue: 400,
          maxDiscount: 200,
          maxUses: 100,
          perUserLimit: 2,
          startsAt: new Date(Date.now() - 3600000).toISOString(),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          isActive: true,
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.code).toBe(couponCode)
      expect(res.body.data.discountValue).toBe(20)
      expect(res.body.data.maxDiscount).toBe(200)
      createdCouponId = res.body.data.id

      // Verify PROMOTION_CREATED audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'PROMOTION_CREATED',
          entityId: createdCouponId,
        },
      })
      expect(audit).not.toBeNull()
      expect(audit?.actorId).toBe(adminId)
    })

    it('POST /api/v1/admin/discounts/coupons should reject duplicate coupon code', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/coupons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: couponCode,
          discountType: 'PERCENTAGE',
          discountValue: 15,
        })

      expect(res.status).toBe(409)
    })

    it('GET /api/v1/admin/discounts/coupons should list coupons with pagination and search', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/discounts/coupons?search=${couponCode}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)
      expect(res.body.data[0].code).toBe(couponCode)
      expect(res.body.pagination).toBeDefined()
    })

    it('GET /api/v1/admin/discounts/coupons/:id should retrieve coupon details', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/discounts/coupons/${createdCouponId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe(createdCouponId)
      expect(res.body.data.code).toBe(couponCode)
    })

    it('PATCH /api/v1/admin/discounts/coupons/:id should update coupon and log PROMOTION_UPDATED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/discounts/coupons/${createdCouponId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          minOrderValue: 450,
          maxDiscount: 250,
          description: 'Updated festive discount',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.minOrderValue).toBe(450)
      expect(res.body.data.maxDiscount).toBe(250)

      // Verify PROMOTION_UPDATED audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'PROMOTION_UPDATED',
          entityId: createdCouponId,
        },
      })
      expect(audit).not.toBeNull()
    })

    it('PATCH /api/v1/admin/discounts/coupons/:id/status should toggle coupon status and log PROMOTION_DISABLED / ENABLED', async () => {
      // Disable
      const resDisable = await request(app)
        .patch(`/api/v1/admin/discounts/coupons/${createdCouponId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })

      expect(resDisable.status).toBe(200)
      expect(resDisable.body.data.isActive).toBe(false)

      const auditDisable = await prisma.auditLog.findFirst({
        where: { action: 'PROMOTION_DISABLED', entityId: createdCouponId },
        orderBy: { createdAt: 'desc' },
      })
      expect(auditDisable).not.toBeNull()

      // Re-enable
      const resEnable = await request(app)
        .patch(`/api/v1/admin/discounts/coupons/${createdCouponId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true })

      expect(resEnable.status).toBe(200)
      expect(resEnable.body.data.isActive).toBe(true)

      const auditEnable = await prisma.auditLog.findFirst({
        where: { action: 'PROMOTION_ENABLED', entityId: createdCouponId },
        orderBy: { createdAt: 'desc' },
      })
      expect(auditEnable).not.toBeNull()
    })
  })

  // ==========================================
  // 3. FESTIVAL CAMPAIGNS & PROMOTIONS CRUD
  // ==========================================
  describe('Festival Campaigns & Promotional Engine', () => {
    let promotionId: string
    const promoSlug = `sankranti-harvest-${timestamp}`

    it('POST /api/v1/admin/discounts/promotions should create festive campaign with products/categories', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Sankranti Harvest Festival ${timestamp}`,
          slug: promoSlug,
          description: 'Celebrate harvest with pure Vedic organic spices',
          title: `Sankranti Harvest ${timestamp}`,
          subtitle: 'Up to 15% off organic spices and herbal teas',
          destinationUrl: '/collections/sankranti-harvest',
          ctaLabel: 'Shop the harvest',
          bannerImageUrl: 'https://cdn.vedhicfoods.com/banners/sankranti-harvest.webp',
          discountType: 'PERCENTAGE',
          discountValue: 15,
          minOrderValue: 300,
          maxDiscount: 150,
          startDate: new Date(Date.now() - 3600000).toISOString(),
          endDate: new Date(Date.now() + 10 * 86400000).toISOString(),
          isActive: true,
          priority: 10,
          termsAndConditions: 'Valid on selected organic spices and herbal teas.',
          productIds: [productAId],
          categoryIds: [categoryAId],
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.slug).toBe(promoSlug)
      expect(res.body.data.title).toBe(`Sankranti Harvest ${timestamp}`)
      expect(res.body.data.subtitle).toBe('Up to 15% off organic spices and herbal teas')
      expect(res.body.data.destinationUrl).toBe('/collections/sankranti-harvest')
      expect(res.body.data.ctaLabel).toBe('Shop the harvest')
      promotionId = res.body.data.id

      const persisted = await prisma.promotion.findUnique({ where: { id: promotionId } })
      expect(persisted?.title).toBe(`Sankranti Harvest ${timestamp}`)
      expect(persisted?.subtitle).toBe('Up to 15% off organic spices and herbal teas')
      expect(persisted?.destinationUrl).toBe('/collections/sankranti-harvest')
      expect(persisted?.ctaLabel).toBe('Shop the harvest')

      // Verify PROMOTION_CREATED audit log
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PROMOTION_CREATED', entityId: promotionId },
      })
      expect(audit).not.toBeNull()
    })

    it('GET /api/v1/promotions/active should return current active festival campaigns', async () => {
      const res = await request(app).get('/api/v1/promotions/active')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.data)).toBe(true)
      const found = res.body.data.find((p: any) => p.id === promotionId)
      expect(found).toBeDefined()
      expect(found.slug).toBe(promoSlug)
      expect(found.title).toBe(`Sankranti Harvest ${timestamp}`)
      expect(found.subtitle).toBe('Up to 15% off organic spices and herbal teas')
      expect(found.destinationUrl).toBe('/collections/sankranti-harvest')
      expect(found.ctaLabel).toBe('Shop the harvest')
    })

    it('GET /api/v1/promotions/:slug should retrieve promotion by slug', async () => {
      const res = await request(app).get(`/api/v1/promotions/${promoSlug}`)
      expect(res.status).toBe(200)
      expect(res.body.data.slug).toBe(promoSlug)
      expect(res.body.data.products.length).toBe(1)
    })

    it('PATCH /api/v1/admin/discounts/promotions/:id should update promotion', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/discounts/promotions/${promotionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          priority: 20,
          description: 'Updated harvest festival description',
          title: `Updated Sankranti Harvest ${timestamp}`,
          subtitle: 'Fresh harvest offers for a limited time',
          destinationUrl: '/collections/festival-specials',
          ctaLabel: 'Explore offers',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.priority).toBe(20)
      expect(res.body.data.title).toBe(`Updated Sankranti Harvest ${timestamp}`)
      expect(res.body.data.subtitle).toBe('Fresh harvest offers for a limited time')
      expect(res.body.data.destinationUrl).toBe('/collections/festival-specials')
      expect(res.body.data.ctaLabel).toBe('Explore offers')

      const persisted = await prisma.promotion.findUnique({ where: { id: promotionId } })
      expect(persisted?.title).toBe(`Updated Sankranti Harvest ${timestamp}`)
      expect(persisted?.subtitle).toBe('Fresh harvest offers for a limited time')
      expect(persisted?.destinationUrl).toBe('/collections/festival-specials')
      expect(persisted?.ctaLabel).toBe('Explore offers')
    })
  })

  // ==========================================
  // 4. COUPON VALIDATION GATES & ELIGIBILITY RULES
  // ==========================================
  describe('Coupon Validation Gates & Eligibility Conditions', () => {
    // 4.1 Invalid Code
    it('should reject nonexistent coupon code', async () => {
      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: 'DOES_NOT_EXIST_CODE',
          items: [{ productId: productAId, quantity: 2 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/invalid/i)
    })

    // 4.2 Disabled Coupon
    it('should reject disabled coupon', async () => {
      const disabledCode = `DISABLED_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: disabledCode,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          isActive: false,
        },
      })

      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: disabledCode,
          items: [{ productId: productAId, quantity: 2 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/disabled/i)
    })

    // 4.3 Expired Coupon
    it('should reject expired coupon', async () => {
      const expiredCode = `EXPIRED_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: expiredCode,
          discountType: 'PERCENTAGE',
          discountValue: 15,
          startsAt: new Date(Date.now() - 10 * 86400000),
          expiresAt: new Date(Date.now() - 1 * 86400000), // Expired yesterday
          isActive: true,
        },
      })

      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: expiredCode,
          items: [{ productId: productAId, quantity: 2 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/expired/i)
    })

    // 4.4 Not Started Coupon
    it('should reject coupon that has not started yet', async () => {
      const futureCode = `FUTURE_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: futureCode,
          discountType: 'PERCENTAGE',
          discountValue: 15,
          startsAt: new Date(Date.now() + 5 * 86400000), // Starts in 5 days
          expiresAt: new Date(Date.now() + 15 * 86400000),
          isActive: true,
        },
      })

      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: futureCode,
          items: [{ productId: productAId, quantity: 2 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/not started/i)
    })

    // 4.5 Minimum Order Value Not Met
    it('should reject coupon when minimum order value is not met', async () => {
      const minOrderCode = `MINORDER_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: minOrderCode,
          discountType: 'PERCENTAGE',
          discountValue: 20,
          minOrderValue: 1000, // Requires 1000
          isActive: true,
        },
      })

      // Product A is ₹300 * 1 = ₹300 (less than ₹1000)
      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: minOrderCode,
          items: [{ productId: productAId, quantity: 1 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/minimum order value/i)
    })

    // 4.6 Global Usage Limit Reached
    it('should reject coupon when global usage limit is reached', async () => {
      const maxUsesCode = `MAXUSES_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: maxUsesCode,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          maxUses: 5,
          usedCount: 5, // Fully consumed
          isActive: true,
        },
      })

      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: maxUsesCode,
          items: [{ productId: productAId, quantity: 2 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/global usage limit/i)
    })

    // 4.7 Per-Customer Limit Reached
    it('should reject coupon when customer limit is reached', async () => {
      const perUserCode = `PERUSER_${timestamp}`
      const coupon = await prisma.coupon.create({
        data: {
          code: perUserCode,
          discountType: 'FIXED_AMOUNT',
          discountValue: 50,
          perUserLimit: 1, // Only 1 use per customer
          isActive: true,
        },
      })

      // Seed a usage record for Customer A
      const mockOrder = await prisma.order.create({
        data: {
          orderNumber: `VF-TEST-${timestamp}-1`,
          userId: customerAId,
          customerName: 'Ananya Sharma',
          customerEmail: 'ananya@test.com',
          phone: '9876543210',
          subtotal: 500,
          total: 500,
        },
      })

      await prisma.couponUsage.create({
        data: {
          couponId: coupon.id,
          userId: customerAId,
          orderId: mockOrder.id,
          discountApplied: 50,
        },
      })

      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: perUserCode,
          items: [{ productId: productAId, quantity: 2 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/maximum usage limit/i)
    })

    // 4.8 Product-Specific Restriction
    it('should reject product-specific coupon when cart has only ineligible products', async () => {
      const prodRestrictedCode = `PROD_ONLY_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: prodRestrictedCode,
          discountType: 'PERCENTAGE',
          discountValue: 20,
          isActive: true,
          products: {
            create: [{ productId: productAId }], // ONLY for Product A
          },
        },
      })

      // Try applying to cart containing ONLY Product B
      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: prodRestrictedCode,
          items: [{ productId: productBId, quantity: 1 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/not applicable/i)
    })

    // 4.9 Category-Specific Restriction
    it('should reject category-specific coupon when cart has only items from another category', async () => {
      const catRestrictedCode = `CAT_ONLY_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: catRestrictedCode,
          discountType: 'PERCENTAGE',
          discountValue: 15,
          isActive: true,
          categories: {
            create: [{ categoryId: categoryAId }], // ONLY Category A (Spices)
          },
        },
      })

      // Try applying with Product B (which belongs to Category B: Herbal Infusions)
      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: catRestrictedCode,
          items: [{ productId: productBId, quantity: 1 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/not applicable/i)
    })
  })

  // ==========================================
  // 5. ACCURATE DISCOUNT COMPUTATION & CAP CHECKS
  // ==========================================
  describe('Accurate Backend Discount Calculations', () => {
    it('should apply discount ONLY to eligible items in a mixed cart', async () => {
      const spiceOnlyCode = `SPICE_ONLY_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: spiceOnlyCode,
          discountType: 'PERCENTAGE',
          discountValue: 20, // 20% off spices only
          isActive: true,
          products: {
            create: [{ productId: productAId }], // Product A: ₹300 * 2 = ₹600
          },
        },
      })

      // Mixed Cart: Product A (₹300 * 2 = ₹600) + Product B (₹500 * 1 = ₹500)
      // Total Cart = ₹1100.
      // Eligible items = Product A (₹600).
      // 20% discount on ₹600 = ₹120. (NOT 20% on ₹1100 which would be ₹220!)
      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: spiceOnlyCode,
          items: [
            { productId: productAId, quantity: 2 },
            { productId: productBId, quantity: 1 },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.eligibleSubtotal).toBe(600)
      expect(res.body.data.subtotal).toBe(1100)
      expect(res.body.data.discountAmount).toBe(120)
    })

    it('should enforce maxDiscount cap on percentage discounts', async () => {
      const cappedCode = `CAPPED_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: cappedCode,
          discountType: 'PERCENTAGE',
          discountValue: 50, // 50% discount
          maxDiscount: 100, // Capped at ₹100
          isActive: true,
        },
      })

      // Product B: ₹500 * 2 = ₹1000. 50% of ₹1000 = ₹500, but capped at ₹100!
      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: cappedCode,
          items: [{ productId: productBId, quantity: 2 }],
        })

      expect(res.status).toBe(200)
      expect(res.body.data.discountAmount).toBe(100)
    })

    it('should cap fixed discounts so total never falls below zero', async () => {
      const fixedHugeCode = `FIXED_HUGE_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: fixedHugeCode,
          discountType: 'FIXED_AMOUNT',
          discountValue: 1000, // ₹1000 fixed off
          isActive: true,
        },
      })

      // Product A: ₹300 * 1 = ₹300.
      // Discount should be capped at ₹300, NEVER ₹1000 (preventing negative totals!)
      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: fixedHugeCode,
          items: [{ productId: productAId, quantity: 1 }],
        })

      expect(res.status).toBe(200)
      expect(res.body.data.discountAmount).toBe(300)
      expect(res.body.data.subtotal).toBe(300)
    })
  })

  // ==========================================
  // 6. CHECKOUT INTEGRATION & PRICE INTEGRITY
  // ==========================================
  describe('Checkout Integration (Prompt 8) & Price Tampering Prevention', () => {
    it('should apply valid coupon during checkout, record order discount, and track COUPON_USED audit', async () => {
      const checkoutPromoCode = `CHECKOUT_PROMO_${timestamp}`
      const coupon = await prisma.coupon.create({
        data: {
          code: checkoutPromoCode,
          discountType: 'FIXED_AMOUNT',
          discountValue: 100,
          minOrderValue: 300,
          maxUses: 10,
          perUserLimit: 2,
          isActive: true,
        },
      })

      // Customer A places order via checkout
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          paymentMethod: 'COD',
          couponCode: checkoutPromoCode,
          items: [{ productId: productAId, quantity: 2 }], // 300 * 2 = 600
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      const order = res.body
      expect(order.subtotal).toBe(600)
      expect(order.discount).toBe(100)
      expect(order.couponCode).toBe(checkoutPromoCode)

      // Subtotal 600 - 100 discount = 500. Free shipping (>= 499). 5% GST on 500 = 25. Total = 525.
      expect(order.shipping).toBe(0)
      expect(order.tax).toBe(25)
      expect(order.total).toBe(525)

      // Verify coupon usage record created in DB
      const usage = await prisma.couponUsage.findFirst({
        where: { couponId: coupon.id, userId: customerAId, orderId: order.orderId },
      })
      expect(usage).not.toBeNull()
      expect(Number(usage?.discountApplied)).toBe(100)

      // Verify COUPON_USED audit log created
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'COUPON_USED',
          entityId: coupon.id,
        },
      })
      expect(audit).not.toBeNull()
      expect(audit?.actorId).toBe(customerAId)
    })

    it('SECURITY: should ignore frontend-injected discount amount and calculate authoritatively', async () => {
      const secureCode = `SECURE_${timestamp}`
      await prisma.coupon.create({
        data: {
          code: secureCode,
          discountType: 'PERCENTAGE',
          discountValue: 10, // 10%
          minOrderValue: 200,
          isActive: true,
        },
      })

      // Attempting to send fabricated discount of ₹9999 or modified total
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({
          addressId: customerBAddressId,
          paymentMethod: 'COD',
          couponCode: secureCode,
          discount: 9999, // HACK ATTEMPT
          total: 1, // HACK ATTEMPT
          items: [{ productId: productAId, quantity: 1 }], // ₹300
        })

      expect(res.status).toBe(201)
      const order = res.body
      // 10% of ₹300 is ₹30, NOT ₹9999!
      expect(order.discount).toBe(30)
      expect(order.subtotal).toBe(300)
      // ₹300 - ₹30 = ₹270. Shipping = ₹49. Tax = 5% of 270 = ₹13.50. Total = ₹332.50
      expect(order.total).toBe(332.5)
      expect(order.total).not.toBe(1)
    })
  })

  // ==========================================
  // 7. CONCURRENT COUPON USE & RACE CONDITIONS
  // ==========================================
  describe('Concurrent Coupon Usage & Race Condition Protection', () => {
    it('should strictly enforce maxUses under high concurrency and prevent over-redemption', async () => {
      const raceCode = `RACE_${timestamp}`
      const coupon = await prisma.coupon.create({
        data: {
          code: raceCode,
          discountType: 'FIXED_AMOUNT',
          discountValue: 50,
          minOrderValue: 200,
          maxUses: 1, // EXACTLY 1 GLOBAL USE ALLOWED!
          perUserLimit: 1,
          usedCount: 0,
          isActive: true,
        },
      })

      // Two customers attempt to place an order at the exact same instant using the single-use coupon
      const reqA = request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          paymentMethod: 'COD',
          couponCode: raceCode,
          items: [{ productId: productAId, quantity: 1 }],
        })

      const reqB = request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({
          addressId: customerBAddressId,
          paymentMethod: 'COD',
          couponCode: raceCode,
          items: [{ productId: productAId, quantity: 1 }],
        })

      const [resA, resB] = await Promise.all([reqA, reqB])

      const statuses = [resA.status, resB.status]
      const successes = statuses.filter((s) => s === 201).length
      const failures = statuses.filter((s) => s === 400).length

      // Exactly 1 checkout must succeed, and exactly 1 must fail due to usage limit reached!
      expect(successes).toBe(1)
      expect(failures).toBe(1)

      // Verify the final coupon usedCount in database is strictly 1
      const finalCoupon = await prisma.coupon.findUnique({
        where: { id: coupon.id },
      })
      expect(finalCoupon?.usedCount).toBe(1)

      // Verify only 1 usage record exists
      const usageCount = await prisma.couponUsage.count({
        where: { couponId: coupon.id },
      })
      expect(usageCount).toBe(1)
    })
  })
})
