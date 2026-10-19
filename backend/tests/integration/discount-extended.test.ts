import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'

const app = createApp()

interface ApiResponseLike {
  status: number
  body: any
}

interface SeedCouponOptions {
  couponCode: string
  discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT'
  discountValue: number
  minOrderValue?: number
  maxDiscount?: number
  maxUses?: number
  usedCount?: number
  perUserLimit?: number
  startsAt?: Date
  expiresAt?: Date
  isActive?: boolean
  productIds?: string[]
  categoryIds?: string[]
}

describe('Discount & Festival Promotion — Extended Matrix', () => {
  const timestamp = Date.now()

  let adminToken: string
  let customerAToken: string
  let customerAId: string
  let customerAPhone: string
  let customerBToken: string
  let customerBId: string
  let customerBPhone: string
  let staffToken: string
  let staffUserId: string
  let staffEmail: string
  let staffPhone: string

  let categoryAId: string
  let categoryBId: string
  let productAId: string
  let productBId: string

  const code = (prefix: string) => `${prefix}_${timestamp}`

  // ==========================================
  // Shared helpers
  // ==========================================

  function expectApiError(res: ApiResponseLike, expectedStatus: number): void {
    expect(res.status).toBe(expectedStatus)
    expect(res.body.success).toBe(false)
    expect(typeof res.body.message).toBe('string')
    expect(res.body.message.length).toBeGreaterThan(0)
    expect(res.body.error).toBe(res.body.message)
  }

  function createCouponViaApi(body: Record<string, unknown>) {
    return request(app)
      .post('/api/v1/admin/discounts/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
  }

  function createPromotionViaApi(body: Record<string, unknown>) {
    return request(app)
      .post('/api/v1/admin/discounts/promotions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
  }

  function patchCouponViaApi(id: string, body: Record<string, unknown>) {
    return request(app)
      .patch(`/api/v1/admin/discounts/coupons/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
  }

  function patchPromotionViaApi(id: string, body: Record<string, unknown>) {
    return request(app)
      .patch(`/api/v1/admin/discounts/promotions/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
  }

  function togglePromotionViaApi(id: string, isActive: boolean) {
    return request(app)
      .patch(`/api/v1/admin/discounts/promotions/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive })
  }

  async function seedCoupon(options: SeedCouponOptions) {
    const { couponCode, productIds, categoryIds, ...data } = options
    return prisma.coupon.create({
      data: {
        code: couponCode,
        discountType: data.discountType ?? 'PERCENTAGE',
        discountValue: data.discountValue,
        minOrderValue: data.minOrderValue,
        maxDiscount: data.maxDiscount,
        maxUses: data.maxUses,
        usedCount: data.usedCount,
        perUserLimit: data.perUserLimit,
        startsAt: data.startsAt,
        expiresAt: data.expiresAt,
        isActive: data.isActive,
        products:
          productIds && productIds.length > 0
            ? { create: productIds.map((productId) => ({ productId })) }
            : undefined,
        categories:
          categoryIds && categoryIds.length > 0
            ? { create: categoryIds.map((categoryId) => ({ categoryId })) }
            : undefined,
      },
    })
  }

  function applyCoupon(
    couponCode: string,
    items: Array<{ productId: string; quantity: number }>,
    token?: string
  ) {
    const req = request(app).post('/api/v1/coupons/apply')
    if (token) {
      req.set('Authorization', `Bearer ${token}`)
    }
    return req.send({ code: couponCode, items })
  }

  function checkoutOrder(token: string, body: Record<string, unknown>) {
    return request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
  }

  function deliveryAddress(fullName: string, phone: string) {
    return {
      fullName,
      phone,
      line1: '12, Extended Matrix Test Lane',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    }
  }

  // ==========================================
  // Setup
  // ==========================================

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    customerAPhone = `91${timestamp}`
    const regA = await AuthService.register({
      fullName: 'Extended Alpha',
      email: `customer.ext.a.${timestamp}@test.com`,
      phone: customerAPhone,
      password: 'Customer@2026!',
    })
    customerAToken = regA.accessToken
    customerAId = regA.user.id

    customerBPhone = `92${timestamp}`
    const regB = await AuthService.register({
      fullName: 'Extended Beta',
      email: `customer.ext.b.${timestamp}@test.com`,
      phone: customerBPhone,
      password: 'Customer@2026!',
    })
    customerBToken = regB.accessToken
    customerBId = regB.user.id

    const staffPassword = 'Staff@Vedhic2026!'
    staffEmail = `disc.ext.staff.${timestamp}@vedhicfoods.com`
    staffPhone = `97${timestamp}`
    const staffUser = await prisma.user.create({
      data: {
        email: staffEmail,
        fullName: 'Disc Ext Staff',
        passwordHash: await AuthService.hashPassword(staffPassword),
        role: 'STAFF',
        phone: staffPhone,
        isActive: true,
      },
    })
    staffUserId = staffUser.id
    const staffRole = await prisma.role.findFirst({ where: { name: 'STAFF' } })
    if (staffRole) {
      await prisma.userRole.create({ data: { userId: staffUser.id, roleId: staffRole.id } })
    }
    const staffLogin = await AuthService.login({ email: staffUser.email, password: staffPassword })
    staffToken = staffLogin.accessToken

    const catA = await prisma.category.create({
      data: {
        name: `Extended Masalas ${timestamp}`,
        slug: `ext-masalas-${timestamp}`,
        description: 'Extended matrix category A',
      },
    })
    categoryAId = catA.id

    const catB = await prisma.category.create({
      data: {
        name: `Extended Infusions ${timestamp}`,
        slug: `ext-infusions-${timestamp}`,
        description: 'Extended matrix category B',
      },
    })
    categoryBId = catB.id

    const prodA = await prisma.product.create({
      data: {
        name: `Extended Product A ${timestamp}`,
        slug: `ext-product-a-${timestamp}`,
        sku: `EXTA-${timestamp}`,
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
        name: `Extended Product B ${timestamp}`,
        slug: `ext-product-b-${timestamp}`,
        sku: `EXTB-${timestamp}`,
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
    const userIds = [customerAId, customerBId, staffUserId].filter(Boolean) as string[]
    const productIds = [productAId, productBId].filter(Boolean) as string[]
    const categoryIds = [categoryAId, categoryBId].filter(Boolean) as string[]

    const ourCoupons = await prisma.coupon.findMany({
      where: { code: { contains: `${timestamp}` } },
      select: { id: true },
    })
    const ourPromotions = await prisma.promotion.findMany({
      where: { slug: { contains: `${timestamp}` } },
      select: { id: true },
    })
    const ourEntityIds = [...ourCoupons.map((c) => c.id), ...ourPromotions.map((p) => p.id)]

    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: userIds } }, { entityId: { in: ourEntityIds } }],
      },
    })

    if (userIds.length > 0) {
      await prisma.couponUsage.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } })
      await prisma.delivery.deleteMany({ where: { order: { userId: { in: userIds } } } })
      await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } })
      await prisma.invoice.deleteMany({ where: { order: { userId: { in: userIds } } } })
      await prisma.order.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } })
      await prisma.cart.deleteMany({ where: { userId: { in: userIds } } })
    }

    if (productIds.length > 0) {
      await prisma.couponProduct.deleteMany({ where: { productId: { in: productIds } } })
      await prisma.promotionProduct.deleteMany({ where: { productId: { in: productIds } } })
    }

    if (categoryIds.length > 0) {
      await prisma.couponCategory.deleteMany({ where: { categoryId: { in: categoryIds } } })
      await prisma.promotionCategory.deleteMany({ where: { categoryId: { in: categoryIds } } })
    }

    await prisma.coupon.deleteMany({ where: { code: { contains: `${timestamp}` } } })
    await prisma.promotion.deleteMany({ where: { slug: { contains: `${timestamp}` } } })

    if (productIds.length > 0) {
      await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } })
      await prisma.product.deleteMany({ where: { id: { in: productIds } } })
    }

    if (categoryIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } })
    }

    if (userIds.length > 0) {
      await prisma.address.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
  })

  // ==========================================
  // SECTION 1 — Creation validation boundaries
  // ==========================================
  describe('Section 1 — Creation validation boundaries (admin token)', () => {
    it('rejects PERCENTAGE coupon with discountValue 0 (400)', async () => {
      const res = await createCouponViaApi({
        code: code('EXTZERO'),
        discountType: 'PERCENTAGE',
        discountValue: 0,
      })
      expectApiError(res, 400)
    })

    it('rejects coupon with discountValue -5 (400)', async () => {
      const res = await createCouponViaApi({
        code: code('EXTNEG'),
        discountType: 'PERCENTAGE',
        discountValue: -5,
      })
      expectApiError(res, 400)
    })

    it('rejects PERCENTAGE coupon with discountValue 150 (400)', async () => {
      const res = await createCouponViaApi({
        code: code('EXT150'),
        discountType: 'PERCENTAGE',
        discountValue: 150,
      })
      expectApiError(res, 400)
    })

    it('accepts PERCENTAGE coupon with discountValue 100 (201)', async () => {
      const res = await createCouponViaApi({
        code: code('EXT100'),
        discountType: 'PERCENTAGE',
        discountValue: 100,
      })
      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.code).toBe(code('EXT100'))
      expect(res.body.data.discountValue).toBe(100)
    })

    it('rejects coupon whose startsAt is after its expiresAt (400)', async () => {
      const res = await createCouponViaApi({
        code: code('EXTDATES'),
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
      expectApiError(res, 400)
    })

    it('rejects duplicate coupon code with 409', async () => {
      const first = await createCouponViaApi({
        code: code('EXTDUP'),
        discountType: 'PERCENTAGE',
        discountValue: 15,
      })
      expect(first.status).toBe(201)

      const second = await createCouponViaApi({
        code: code('EXTDUP'),
        discountType: 'PERCENTAGE',
        discountValue: 15,
      })
      expectApiError(second, 409)
    })

    it('uppercases code on create and applies it via lowercase input (200)', async () => {
      const lowercaseCode = `festive10_${timestamp}`

      const created = await createCouponViaApi({
        code: lowercaseCode,
        discountType: 'PERCENTAGE',
        discountValue: 10,
      })
      expect(created.status).toBe(201)
      expect(created.body.data.code).toBe(lowercaseCode.toUpperCase())

      const applied = await applyCoupon(lowercaseCode, [{ productId: productAId, quantity: 1 }], customerAToken)
      expect(applied.status).toBe(200)
      expect(applied.body.success).toBe(true)
      expect(applied.body.data.discountAmount).toBe(30)
    })
  })

  // ==========================================
  // SECTION 2 — Calculation correctness
  // ==========================================
  describe('Section 2 — Calculation correctness (apply with customerA token)', () => {
    it('20% storewide on productA x2: 600 → discount 120', async () => {
      const couponCode = code('EXTPCT20')
      await seedCoupon({ couponCode, discountType: 'PERCENTAGE', discountValue: 20 })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 2 }], customerAToken)
      expect(res.status).toBe(200)
      expect(res.body.data.subtotal).toBe(600)
      expect(res.body.data.eligibleSubtotal).toBe(600)
      expect(res.body.data.discountAmount).toBe(120)
    })

    it('FIXED_AMOUNT 100 storewide on productA x2: 600 → discount 100', async () => {
      const couponCode = code('EXTFIX100')
      await seedCoupon({ couponCode, discountType: 'FIXED_AMOUNT', discountValue: 100 })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 2 }], customerAToken)
      expect(res.status).toBe(200)
      expect(res.body.data.subtotal).toBe(600)
      expect(res.body.data.discountAmount).toBe(100)
    })

    it('product-specific 20% limits discount to eligible lines in a mixed cart', async () => {
      const couponCode = code('EXTPRODA20')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 20,
        productIds: [productAId],
      })

      const res = await applyCoupon(
        couponCode,
        [
          { productId: productAId, quantity: 2 },
          { productId: productBId, quantity: 1 },
        ],
        customerAToken
      )
      expect(res.status).toBe(200)
      expect(res.body.data.subtotal).toBe(1100)
      expect(res.body.data.eligibleSubtotal).toBe(600)
      expect(res.body.data.discountAmount).toBe(120)
    })

    it('category-specific 10% limits discount to the eligible category in a mixed cart', async () => {
      const couponCode = code('EXTCATA10')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        categoryIds: [categoryAId],
      })

      const res = await applyCoupon(
        couponCode,
        [
          { productId: productAId, quantity: 1 },
          { productId: productBId, quantity: 1 },
        ],
        customerAToken
      )
      expect(res.status).toBe(200)
      expect(res.body.data.subtotal).toBe(800)
      expect(res.body.data.eligibleSubtotal).toBe(300)
      expect(res.body.data.discountAmount).toBe(30)
    })

    it('minOrderValue boundary: 300 on a 300 cart passes, 301 fails', async () => {
      const passCode = code('EXTMIN300')
      await seedCoupon({
        couponCode: passCode,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        minOrderValue: 300,
      })
      const pass = await applyCoupon(passCode, [{ productId: productAId, quantity: 1 }], customerAToken)
      expect(pass.status).toBe(200)
      expect(pass.body.data.discountAmount).toBe(30)

      const failCode = code('EXTMIN301')
      await seedCoupon({
        couponCode: failCode,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        minOrderValue: 301,
      })
      const fail = await applyCoupon(failCode, [{ productId: productAId, quantity: 1 }], customerAToken)
      expectApiError(fail, 400)
      expect(fail.body.message).toMatch(/minimum order value/i)
    })

    it('maxDiscount cap: 50% of 1000 capped to 100', async () => {
      const couponCode = code('EXTCAP100')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 50,
        maxDiscount: 100,
      })

      const res = await applyCoupon(couponCode, [{ productId: productBId, quantity: 2 }], customerAToken)
      expect(res.status).toBe(200)
      expect(res.body.data.subtotal).toBe(1000)
      expect(res.body.data.discountAmount).toBe(100)
    })

    it('FIXED_AMOUNT 10000 caps at the eligible subtotal (300), not the cart total (800)', async () => {
      const couponCode = code('EXTFIXHUGE')
      await seedCoupon({
        couponCode,
        discountType: 'FIXED_AMOUNT',
        discountValue: 10000,
        productIds: [productAId],
      })

      const res = await applyCoupon(
        couponCode,
        [
          { productId: productAId, quantity: 1 },
          { productId: productBId, quantity: 1 },
        ],
        customerAToken
      )
      expect(res.status).toBe(200)
      expect(res.body.data.subtotal).toBe(800)
      expect(res.body.data.eligibleSubtotal).toBe(300)
      expect(res.body.data.discountAmount).toBe(300)
    })

    it('100% coupon covers the full eligible amount (300)', async () => {
      const couponCode = code('EXTFULL100')
      await seedCoupon({ couponCode, discountType: 'PERCENTAGE', discountValue: 100 })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 1 }], customerAToken)
      expect(res.status).toBe(200)
      expect(res.body.data.discountAmount).toBe(300)
    })

    it('rounds percentage discount precisely: 12.5% of 500 = 62.5', async () => {
      const couponCode = code('EXTPCT125')
      await seedCoupon({ couponCode, discountType: 'PERCENTAGE', discountValue: 12.5 })

      const res = await applyCoupon(couponCode, [{ productId: productBId, quantity: 1 }], customerAToken)
      expect(res.status).toBe(200)
      expect(res.body.data.discountAmount).toBe(62.5)
    })
  })

  // ==========================================
  // SECTION 3 — Eligibility gates
  // ==========================================
  describe('Section 3 — Eligibility gates (apply → 400)', () => {
    it('rejects a disabled coupon (400)', async () => {
      const couponCode = code('EXTDISABLED')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 20,
        isActive: false,
      })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 2 }], customerAToken)
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/disabled/i)
    })

    it('rejects an expired coupon (400)', async () => {
      const couponCode = code('EXTEXPIRED')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 15,
        startsAt: new Date(Date.now() - 10 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
        isActive: true,
      })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 2 }], customerAToken)
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/expired/i)
    })

    it('rejects a coupon that has not started yet (400)', async () => {
      const couponCode = code('EXTFUTURE')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 15,
        startsAt: new Date(Date.now() + 5 * 86400000),
        expiresAt: new Date(Date.now() + 15 * 86400000),
        isActive: true,
      })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 2 }], customerAToken)
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/not started/i)
    })

    it('rejects a coupon whose global usage limit is exhausted (400)', async () => {
      const couponCode = code('EXTMAXUSE')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxUses: 5,
        usedCount: 5,
        isActive: true,
      })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 2 }], customerAToken)
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/global usage limit/i)
    })

    it('rejects a coupon whose per-user limit is already consumed (400)', async () => {
      const couponCode = code('EXTPERUSER')
      const coupon = await seedCoupon({
        couponCode,
        discountType: 'FIXED_AMOUNT',
        discountValue: 50,
        perUserLimit: 1,
        isActive: true,
      })

      const mockOrder = await prisma.order.create({
        data: {
          orderNumber: `VF-EXT-${timestamp}`,
          userId: staffUserId,
          customerName: 'Disc Ext Staff',
          customerEmail: staffEmail,
          phone: staffPhone,
          subtotal: 500,
          total: 500,
        },
      })

      await prisma.couponUsage.create({
        data: {
          couponId: coupon.id,
          userId: staffUserId,
          orderId: mockOrder.id,
          discountApplied: 50,
        },
      })

      const res = await applyCoupon(couponCode, [{ productId: productAId, quantity: 2 }], staffToken)
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/maximum usage limit/i)
    })

    it('rejects a product-restricted coupon when the cart only has other products (400)', async () => {
      const couponCode = code('EXTPRODONLYA')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 20,
        productIds: [productAId],
        isActive: true,
      })

      const res = await applyCoupon(couponCode, [{ productId: productBId, quantity: 1 }], customerAToken)
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/not applicable/i)
    })

    it('rejects a category-restricted coupon when the cart only has another category (400)', async () => {
      const couponCode = code('EXTCATONLYA')
      await seedCoupon({
        couponCode,
        discountType: 'PERCENTAGE',
        discountValue: 15,
        categoryIds: [categoryAId],
        isActive: true,
      })

      const res = await applyCoupon(couponCode, [{ productId: productBId, quantity: 1 }], customerAToken)
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/not applicable/i)
    })

    it('rejects a nonexistent coupon code (400)', async () => {
      const res = await applyCoupon(
        code('EXTGHOST'),
        [{ productId: productAId, quantity: 2 }],
        customerAToken
      )
      expectApiError(res, 400)
      expect(res.body.message).toMatch(/invalid/i)
    })
  })

  // ==========================================
  // SECTION 4 — Festival promotion ON/OFF + date windows
  // ==========================================
  describe('Section 4 — Festival promotion ON/OFF + date windows', () => {
    let activePromotionId: string
    const activeSlug = `ext-active-${timestamp}`

    it('creates an active promotion exposed by /promotions/active and /promotions/:slug', async () => {
      const created = await createPromotionViaApi({
        name: `Extended Festival ${timestamp}`,
        slug: activeSlug,
        description: 'Extended matrix active campaign',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startDate: new Date(Date.now() - 3600000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        isActive: true,
        productIds: [productAId],
      })
      expect(created.status).toBe(201)
      expect(created.body.success).toBe(true)
      expect(created.body.data.slug).toBe(activeSlug)
      activePromotionId = created.body.data.id

      const active = await request(app).get('/api/v1/promotions/active')
      expect(active.status).toBe(200)
      expect(active.body.success).toBe(true)
      const found = active.body.data.find((p: any) => p.id === activePromotionId)
      expect(found).toBeDefined()
      expect(found.slug).toBe(activeSlug)

      const bySlug = await request(app).get(`/api/v1/promotions/${activeSlug}`)
      expect(bySlug.status).toBe(200)
      expect(bySlug.body.success).toBe(true)
      expect(bySlug.body.data.slug).toBe(activeSlug)
      expect(bySlug.body.data.products.length).toBe(1)
    })

    it('toggles the promotion off and hides it from active list and slug lookup', async () => {
      const toggled = await togglePromotionViaApi(activePromotionId, false)
      expect(toggled.status).toBe(200)
      expect(toggled.body.data.isActive).toBe(false)

      const active = await request(app).get('/api/v1/promotions/active')
      expect(active.status).toBe(200)
      const found = active.body.data.find((p: any) => p.id === activePromotionId)
      expect(found).toBeUndefined()

      const bySlug = await request(app).get(`/api/v1/promotions/${activeSlug}`)
      expectApiError(bySlug, 400)
    })

    it('excludes a future-dated promotion from the active list', async () => {
      const created = await createPromotionViaApi({
        name: `Extended Future Promo ${timestamp}`,
        slug: `ext-future-${timestamp}`,
        discountType: 'PERCENTAGE',
        discountValue: 25,
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        isActive: true,
      })
      expect(created.status).toBe(201)
      const futureId = created.body.data.id

      const active = await request(app).get('/api/v1/promotions/active')
      expect(active.status).toBe(200)
      const found = active.body.data.find((p: any) => p.id === futureId)
      expect(found).toBeUndefined()
    })

    it('excludes a past-dated promotion from the active list', async () => {
      const created = await createPromotionViaApi({
        name: `Extended Past Promo ${timestamp}`,
        slug: `ext-past-${timestamp}`,
        discountType: 'PERCENTAGE',
        discountValue: 25,
        startDate: new Date(Date.now() - 2 * 86400000).toISOString(),
        endDate: new Date(Date.now() - 86400000).toISOString(),
        isActive: true,
      })
      expect(created.status).toBe(201)
      const pastId = created.body.data.id

      const active = await request(app).get('/api/v1/promotions/active')
      expect(active.status).toBe(200)
      const found = active.body.data.find((p: any) => p.id === pastId)
      expect(found).toBeUndefined()
    })

    it('returns 400 for a nonexistent promotion slug', async () => {
      const res = await request(app).get(`/api/v1/promotions/ext-missing-${timestamp}`)
      expectApiError(res, 400)
    })

    it('rejects promotion creation with PERCENTAGE discountValue 150 (400)', async () => {
      const res = await createPromotionViaApi({
        name: `Extended Invalid Promo ${timestamp}`,
        slug: `ext-invalid-${timestamp}`,
        discountType: 'PERCENTAGE',
        discountValue: 150,
        startDate: new Date(Date.now() - 3600000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        isActive: true,
      })
      expectApiError(res, 400)
    })
  })

  // ==========================================
  // SECTION 5 — Update validation gaps
  // ==========================================
  describe('Section 5 — Update validation gaps (fixed behaviour = 400)', () => {
    it('rejects coupon PATCH raising a PERCENTAGE value above 100 without discountType (400)', async () => {
      const created = await createCouponViaApi({
        code: code('EXTUPD150'),
        discountType: 'PERCENTAGE',
        discountValue: 10,
      })
      expect(created.status).toBe(201)

      const patched = await patchCouponViaApi(created.body.data.id, { discountValue: 150 })
      expectApiError(patched, 400)
    })

    it('rejects coupon PATCH moving startsAt past the existing expiresAt (400)', async () => {
      const created = await createCouponViaApi({
        code: code('EXTUPDDATE'),
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startsAt: new Date(Date.now()).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
      expect(created.status).toBe(201)

      const patched = await patchCouponViaApi(created.body.data.id, {
        startsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
      })
      expectApiError(patched, 400)
    })

    it('preserves the stored date window on an unrelated partial PATCH (400 window, no data loss)', async () => {
      const startsAt = new Date(Date.now())
      const expiresAt = new Date(Date.now() + 30 * 86400000)
      const created = await createCouponViaApi({
        code: code('EXTUPDKEEP'),
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startsAt: startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      })
      expect(created.status).toBe(201)

      const patched = await patchCouponViaApi(created.body.data.id, { description: 'only description' })
      expect(patched.status).toBe(200)
      // The window must survive a partial update that never mentions the dates.
      expect(patched.body.data.startsAt).toBeTruthy()
      expect(patched.body.data.expiresAt).toBeTruthy()

      const dbCoupon = await prisma.coupon.findUnique({ where: { id: created.body.data.id } })
      expect(dbCoupon?.startsAt).not.toBeNull()
      expect(dbCoupon?.expiresAt).not.toBeNull()
    })

    it('rejects promotion PATCH moving endDate before the existing startDate (400)', async () => {
      const created = await createPromotionViaApi({
        name: `Extended Window Promo ${timestamp}`,
        slug: `ext-window-${timestamp}`,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startDate: new Date(Date.now()).toISOString(),
        endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        isActive: true,
      })
      expect(created.status).toBe(201)

      const patched = await patchPromotionViaApi(created.body.data.id, {
        endDate: new Date(Date.now() - 5 * 86400000).toISOString(),
      })
      expectApiError(patched, 400)
    })

    it('rejects promotion PATCH raising a PERCENTAGE value above 100 without discountType (400)', async () => {
      const created = await createPromotionViaApi({
        name: `Extended Update Promo ${timestamp}`,
        slug: `ext-upd-${timestamp}`,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startDate: new Date(Date.now()).toISOString(),
        endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        isActive: true,
      })
      expect(created.status).toBe(201)

      const patched = await patchPromotionViaApi(created.body.data.id, { discountValue: 150 })
      expectApiError(patched, 400)
    })

    it('accepts coupon PATCH switching to FIXED_AMOUNT with discountValue 150 (200)', async () => {
      const created = await createCouponViaApi({
        code: code('EXTUPDFIX'),
        discountType: 'PERCENTAGE',
        discountValue: 10,
      })
      expect(created.status).toBe(201)

      const patched = await patchCouponViaApi(created.body.data.id, {
        discountType: 'FIXED_AMOUNT',
        discountValue: 150,
      })
      expect(patched.status).toBe(200)
      expect(patched.body.success).toBe(true)
      expect(patched.body.data.discountType).toBe('FIXED_AMOUNT')
      expect(patched.body.data.discountValue).toBe(150)
    })
  })

  // ==========================================
  // SECTION 6 — Stacking / single-discount enforcement
  // ==========================================
  describe('Section 6 — Stacking / single-discount enforcement', () => {
    it('ignores an extra bogus couponCodes array and keeps only couponCode', async () => {
      const codeA = code('EXTSTACKA')
      const codeB = code('EXTSTACKB')
      await seedCoupon({ couponCode: codeA, discountType: 'FIXED_AMOUNT', discountValue: 100 })
      await seedCoupon({ couponCode: codeB, discountType: 'PERCENTAGE', discountValue: 50 })

      const res = await checkoutOrder(customerBToken, {
        paymentMethod: 'COD',
        couponCode: codeA,
        couponCodes: [codeB],
        address: deliveryAddress('Extended Beta', customerBPhone),
        items: [{ productId: productAId, quantity: 2 }],
      })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.subtotal).toBe(600)
      expect(res.body.couponCode).toBe(codeA)
      expect(res.body.discount).toBe(100)
    })

    it('applies exactly one coupon to a mixed cart with no compounding (discount 120)', async () => {
      const singleCode = code('EXTMIX20')
      await seedCoupon({
        couponCode: singleCode,
        discountType: 'PERCENTAGE',
        discountValue: 20,
        productIds: [productAId],
      })

      const res = await checkoutOrder(customerAToken, {
        paymentMethod: 'COD',
        couponCode: singleCode,
        address: deliveryAddress('Extended Alpha', customerAPhone),
        items: [
          { productId: productAId, quantity: 2 },
          { productId: productBId, quantity: 1 },
        ],
      })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.subtotal).toBe(1100)
      expect(res.body.couponCode).toBe(singleCode)
      expect(res.body.discount).toBe(120)
    })
  })

  // ==========================================
  // SECTION 7 — Apply-level tamper resistance
  // ==========================================
  describe('Section 7 — Apply-level tamper resistance', () => {
    it('ignores client-supplied price/discount/total and computes from the DB (120)', async () => {
      const couponCode = code('EXTTAMPER')
      await seedCoupon({ couponCode, discountType: 'PERCENTAGE', discountValue: 20 })

      const res = await request(app)
        .post('/api/v1/coupons/apply')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: couponCode,
          items: [{ productId: productAId, quantity: 2 }],
          price: 1,
          discount: 9999,
          total: 1,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.subtotal).toBe(600)
      expect(res.body.data.discountAmount).toBe(120)
      expect(res.body.data.discountAmount).not.toBe(9999)
    })
  })
})
