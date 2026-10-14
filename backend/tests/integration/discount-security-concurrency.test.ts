import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'

const app = createApp()

describe('Discount Security, Tamper Resistance & Concurrency', () => {
  const timestamp = Date.now()

  let adminToken = ''
  let customerAToken = ''
  let customerAId = ''
  let customerAPhone = ''
  let staffToken = ''
  let staffUserId = ''
  let categoryId = ''
  let productId = ''
  let topUpProductId = ''
  let rbacCouponId = ''

  const raceTokens: string[] = []
  const raceUserIds: string[] = []

  const rbacCode = `RBAC_${timestamp}`
  const tamperCode = `TAMPER10_${timestamp}`
  const lowercaseCode = `LOWERCASE_${timestamp}`
  const globalRaceCode = `RACEGLOBAL_${timestamp}`
  const perUserRaceCode = `RACEPERUSER_${timestamp}`
  const promotionProbeId = '00000000-0000-0000-0000-000000000001'

  const productPrice = 200
  const topUpPrice = 100

  const phoneFor = (index: number): string =>
    `9${String((timestamp + index) % 1000000000).padStart(9, '0')}`

  const inlineAddress = (fullName: string, phone: string) => ({
    fullName,
    phone,
    line1: '42, Security Lane',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  })

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    customerAPhone = phoneFor(0)
    const customerA = await AuthService.register({
      fullName: 'Aditi Rao',
      email: `disc.sec.a.${timestamp}@test.com`,
      phone: customerAPhone,
      password: 'Customer@2026!',
    })
    customerAToken = customerA.accessToken
    customerAId = customerA.user.id

    for (let i = 0; i < 8; i++) {
      const racer = await AuthService.register({
        fullName: `Race Customer ${i + 1}`,
        email: `disc.sec.race${i + 1}.${timestamp}@test.com`,
        phone: phoneFor(i + 1),
        password: 'Customer@2026!',
      })
      raceTokens.push(racer.accessToken)
      raceUserIds.push(racer.user.id)
    }

    const staffPassword = 'Staff@Vedhic2026!'
    const staffUser = await prisma.user.create({
      data: {
        email: `disc.sec.staff.${timestamp}@vedhicfoods.com`,
        fullName: 'Disc Sec Staff',
        passwordHash: await AuthService.hashPassword(staffPassword),
        role: 'STAFF',
        phone: phoneFor(20),
        isActive: true,
      },
    })
    staffUserId = staffUser.id

    const staffRole = await prisma.role.findFirst({ where: { name: 'STAFF' } })
    if (staffRole) {
      await prisma.userRole.create({ data: { userId: staffUser.id, roleId: staffRole.id } })
    }
    staffToken = (await AuthService.login({ email: staffUser.email, password: staffPassword }))
      .accessToken

    const category = await prisma.category.create({
      data: {
        name: `Security Concurrency ${timestamp}`,
        slug: `security-concurrency-${timestamp}`,
        description: 'Discount security integration fixtures',
      },
    })
    categoryId = category.id

    const product = await prisma.product.create({
      data: {
        name: `Security Race Podi ${timestamp}`,
        slug: `security-race-podi-${timestamp}`,
        sku: `SECRACE-${timestamp}`,
        price: productPrice,
        mrp: 240,
        stock: 200,
        categoryId,
        isActive: true,
        status: 'PUBLISHED',
        inventory: {
          create: { availableQuantity: 200, reservedQuantity: 0, soldQuantity: 0 },
        },
      },
    })
    productId = product.id

    const topUpProduct = await prisma.product.create({
      data: {
        name: `Security Topup Ladoo ${timestamp}`,
        slug: `security-topup-ladoo-${timestamp}`,
        sku: `SECTOPUP-${timestamp}`,
        price: topUpPrice,
        mrp: 120,
        stock: 200,
        categoryId,
        isActive: true,
        status: 'PUBLISHED',
        inventory: {
          create: { availableQuantity: 200, reservedQuantity: 0, soldQuantity: 0 },
        },
      },
    })
    topUpProductId = topUpProduct.id

    const rbacRes = await request(app)
      .post('/api/v1/admin/discounts/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: rbacCode,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        minOrderValue: 100,
        maxUses: 10,
        perUserLimit: 2,
      })
    expect(rbacRes.status).toBe(201)
    rbacCouponId = String(rbacRes.body?.data?.id ?? promotionProbeId)
  })

  afterAll(async () => {
    const userIds = [customerAId, staffUserId, ...raceUserIds].filter(
      (id): id is string => Boolean(id)
    )
    const productIds = [productId, topUpProductId].filter((id): id is string => Boolean(id))
    const categoryIds = [categoryId].filter((id): id is string => Boolean(id))

    if (userIds.length > 0) {
      await prisma.couponUsage.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } })
      await prisma.delivery.deleteMany({ where: { order: { userId: { in: userIds } } } })
      await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } })
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
  // SECTION 1 — AUTHORIZATION
  // ==========================================
  describe('Section 1 - Authorization', () => {
    it('rejects anonymous requests to admin discount endpoints with 401', async () => {
      const listRes = await request(app).get('/api/v1/admin/discounts/coupons')
      expect(listRes.status).toBe(401)

      const createCouponRes = await request(app)
        .post('/api/v1/admin/discounts/coupons')
        .send({ code: `ANONCOUPON_${timestamp}`, discountType: 'PERCENTAGE', discountValue: 10 })
      expect(createCouponRes.status).toBe(401)

      const createPromotionRes = await request(app)
        .post('/api/v1/admin/discounts/promotions')
        .send({
          name: `Anon Promo ${timestamp}`,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
        })
      expect(createPromotionRes.status).toBe(401)
    })

    it('rejects a customer token creating a coupon with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/coupons')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          code: `CUSTHACK_${timestamp}`,
          discountType: 'PERCENTAGE',
          discountValue: 90,
        })
      expect(res.status).toBe(403)
    })

    it('rejects a customer token updating a coupon with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/discounts/coupons/${rbacCouponId}`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ discountValue: 99 })
      expect(res.status).toBe(403)
    })

    it('rejects a customer token toggling coupon status with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/discounts/coupons/${rbacCouponId}/status`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ isActive: false })
      expect(res.status).toBe(403)
    })

    it('rejects a customer token deleting a coupon with 403', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/discounts/coupons/${rbacCouponId}`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(res.status).toBe(403)
    })

    it('rejects a customer token creating a promotion with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/promotions')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          name: `Customer Promo ${timestamp}`,
          discountType: 'PERCENTAGE',
          discountValue: 50,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
        })
      expect(res.status).toBe(403)
    })

    it('rejects a customer token updating a promotion with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/discounts/promotions/${promotionProbeId}`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ discountValue: 99 })
      expect(res.status).toBe(403)
    })

    it('rejects a customer token listing coupons with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/discounts/coupons')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(res.status).toBe(403)
    })

    it('allows a staff token holding discounts.read to list coupons with 200', async () => {
      const res = await request(app)
        .get('/api/v1/admin/discounts/coupons')
        .set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('rejects a staff token without discounts.create creating a coupon with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/coupons')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          code: `STAFFHACK_${timestamp}`,
          discountType: 'PERCENTAGE',
          discountValue: 90,
        })
      expect(res.status).toBe(403)
    })

    it('rejects a staff token without discounts.update updating a coupon with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/discounts/coupons/${rbacCouponId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ discountValue: 99 })
      expect(res.status).toBe(403)
    })

    it('rejects a staff token without discounts.delete deleting a coupon with 403', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/discounts/coupons/${rbacCouponId}`)
        .set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(403)
    })

    it('rejects a staff token without discounts.create creating a promotion with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/discounts/promotions')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: `Staff Promo ${timestamp}`,
          discountType: 'PERCENTAGE',
          discountValue: 50,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
        })
      expect(res.status).toBe(403)
    })
  })

  // ==========================================
  // SECTION 2 — CHECKOUT TAMPER RESISTANCE
  // ==========================================
  describe('Section 2 - Checkout Tamper Resistance (server authoritative)', () => {
    it('ignores injected discount/subtotal/total fields and prices the order from the database', async () => {
      await prisma.coupon.create({
        data: {
          code: tamperCode,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          minOrderValue: 100,
          maxUses: 50,
          perUserLimit: 5,
          isActive: true,
        },
      })

      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          paymentMethod: 'COD',
          couponCode: tamperCode,
          discount: 9999,
          total: 1,
          subtotal: 1,
          address: inlineAddress('Aditi Rao', customerAPhone),
          items: [
            { productId, quantity: 1 },
            { productId: topUpProductId, quantity: 1 },
          ],
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.subtotal).toBe(300)
      expect(res.body.discount).toBe(30)
      expect(res.body.couponCode).toBe(tamperCode)
      expect(res.body.total).not.toBe(1)
      expect(res.body.total).toBeGreaterThan(0)
    })

    it('ignores injected line-item price and name fields and uses the database price', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          paymentMethod: 'COD',
          address: inlineAddress('Aditi Rao', customerAPhone),
          items: [{ productId, quantity: 1, price: 1, name: 'HACK' }],
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.subtotal).toBe(productPrice)
      expect(res.body.discount).toBe(0)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].quantity).toBe(1)
      expect(res.body.items[0].price).toBe(productPrice)
      expect(res.body.items[0].subtotal).toBe(productPrice)
      expect(res.body.items[0].name).not.toBe('HACK')
      expect(res.body.items[0].name).toContain(String(timestamp))
    })

    it('accepts a lowercase coupon code and stores the canonical uppercase code on the order', async () => {
      await prisma.coupon.create({
        data: {
          code: lowercaseCode,
          discountType: 'FIXED_AMOUNT',
          discountValue: 25,
          minOrderValue: 100,
          maxUses: 20,
          perUserLimit: 5,
          isActive: true,
        },
      })

      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          paymentMethod: 'COD',
          couponCode: lowercaseCode.toLowerCase(),
          address: inlineAddress('Aditi Rao', customerAPhone),
          items: [{ productId, quantity: 1 }],
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.couponCode).toBe(lowercaseCode)
      expect(res.body.discount).toBe(25)
    })
  })

  // ==========================================
  // SECTION 3 — CONCURRENCY (GLOBAL USAGE LIMIT)
  // ==========================================
  describe('Section 3 - Global usage limit concurrency', () => {
    it('enforces maxUses=3 exactly under an 8-customer parallel checkout race', async () => {
      const coupon = await prisma.coupon.create({
        data: {
          code: globalRaceCode,
          discountType: 'FIXED_AMOUNT',
          discountValue: 50,
          minOrderValue: 100,
          maxUses: 3,
          perUserLimit: 5,
          usedCount: 0,
          isActive: true,
        },
      })

      const responses = await Promise.all(
        raceTokens.map((token, index) =>
          request(app)
            .post('/api/v1/checkout')
            .set('Authorization', `Bearer ${token}`)
            .send({
              paymentMethod: 'COD',
              couponCode: globalRaceCode,
              address: inlineAddress(`Race Customer ${index + 1}`, phoneFor(index + 1)),
              items: [{ productId, quantity: 1 }],
            })
        )
      )

      const successes = responses.filter((r) => r.status === 201)
      const failures = responses.filter((r) => r.status === 400)

      expect(responses).toHaveLength(8)
      expect(successes.length).toBe(3)
      expect(failures.length).toBe(5)

      for (const success of successes) {
        expect(success.body.success).toBe(true)
        expect(success.body.couponCode).toBe(globalRaceCode)
      }
      for (const failure of failures) {
        expect(failure.body.message).toMatch(/usage limit/i)
        expect(failure.body.error).toBe(failure.body.message)
      }

      const reloaded = await prisma.coupon.findUnique({ where: { id: coupon.id } })
      expect(reloaded?.usedCount).toBe(3)

      const usageCount = await prisma.couponUsage.count({ where: { couponId: coupon.id } })
      expect(usageCount).toBe(3)
    })
  })

  // ==========================================
  // SECTION 4 — CONCURRENCY (PER-CUSTOMER USAGE LIMIT)
  // ==========================================
  describe('Section 4 - Per-customer usage limit concurrency', () => {
    it('enforces perUserLimit=1 exactly under a 5-request same-customer parallel race', async () => {
      const coupon = await prisma.coupon.create({
        data: {
          code: perUserRaceCode,
          discountType: 'FIXED_AMOUNT',
          discountValue: 50,
          minOrderValue: 100,
          maxUses: 20,
          perUserLimit: 1,
          usedCount: 0,
          isActive: true,
        },
      })

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app)
            .post('/api/v1/checkout')
            .set('Authorization', `Bearer ${customerAToken}`)
            .send({
              paymentMethod: 'COD',
              couponCode: perUserRaceCode,
              address: inlineAddress('Aditi Rao', customerAPhone),
              items: [{ productId, quantity: 1 }],
            })
        )
      )

      const successes = responses.filter((r) => r.status === 201)
      const failures = responses.filter((r) => r.status === 400)

      expect(responses).toHaveLength(5)
      expect(successes.length).toBe(1)
      expect(failures.length).toBe(4)

      for (const success of successes) {
        expect(success.body.success).toBe(true)
        expect(success.body.couponCode).toBe(perUserRaceCode)
      }
      for (const failure of failures) {
        expect(failure.body.message).toMatch(/usage limit/i)
        expect(failure.body.error).toBe(failure.body.message)
      }

      const reloaded = await prisma.coupon.findUnique({ where: { id: coupon.id } })
      expect(reloaded?.usedCount).toBe(1)

      const usageCount = await prisma.couponUsage.count({ where: { couponId: coupon.id } })
      expect(usageCount).toBe(1)
    })
  })

  // ==========================================
  // SECTION 5 — USAGE ACCOUNTING INTEGRITY
  // ==========================================
  describe('Section 5 - Usage accounting integrity', () => {
    it('keeps usedCount equal to usage rows and never lets a user exceed perUserLimit', async () => {
      const suiteCoupons = await prisma.coupon.findMany({
        where: { code: { contains: `${timestamp}` } },
        select: { id: true, code: true, usedCount: true, perUserLimit: true },
      })
      expect(suiteCoupons.length).toBeGreaterThanOrEqual(5)

      const usages = await prisma.couponUsage.findMany({
        where: { couponId: { in: suiteCoupons.map((c) => c.id) } },
        select: { couponId: true, userId: true },
      })

      const usageByCouponAndUser = new Map<string, { couponId: string; count: number }>()
      for (const usage of usages) {
        const key = `${usage.couponId}|${usage.userId}`
        const existing = usageByCouponAndUser.get(key)
        if (existing) {
          existing.count += 1
        } else {
          usageByCouponAndUser.set(key, { couponId: usage.couponId, count: 1 })
        }
      }

      const couponById = new Map(suiteCoupons.map((c) => [c.id, c]))
      for (const entry of usageByCouponAndUser.values()) {
        const coupon = couponById.get(entry.couponId)
        expect(coupon).toBeDefined()
        expect(entry.count).toBeLessThanOrEqual(coupon!.perUserLimit)
      }

      const raceCoupons = suiteCoupons.filter(
        (c) => c.code === globalRaceCode || c.code === perUserRaceCode
      )
      expect(raceCoupons.length).toBe(2)

      for (const coupon of raceCoupons) {
        const usageCount = await prisma.couponUsage.count({ where: { couponId: coupon.id } })
        expect(coupon.usedCount).toBe(usageCount)
      }

      const globalRaceCoupon = raceCoupons.find((c) => c.code === globalRaceCode)
      const perUserRaceCoupon = raceCoupons.find((c) => c.code === perUserRaceCode)
      expect(globalRaceCoupon?.usedCount).toBe(3)
      expect(perUserRaceCoupon?.usedCount).toBe(1)
    })
  })
})
