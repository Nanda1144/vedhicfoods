import './_safety'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { EmailService } from '../../src/services/email.service'
import { InventoryService } from '../../src/services/inventory.service'
import { OrderStatus, PaymentStatus } from '@prisma/client'

const app = createApp()

/**
 * Extended checkout / order-creation coverage.
 *
 * Focuses on the parts not exercised by checkout-order-workflow.test.ts:
 *  - the full validation surface (deleted / unpublished products, schema gates)
 *  - the pricing engine boundary (shipping threshold, tax on discounted amount)
 *  - coupon authoring surface end-to-end (percentage, fixed cap, expiry, gating)
 *  - immutable price + customer snapshots
 *  - transactional rollback and dependency-failure resilience
 *  - idempotency under cross-account reuse and genuine concurrency
 */
describe('Checkout & Order Creation — Extended Matrix', () => {
  let adminToken: string
  let customerAToken: string
  let customerAId: string
  let customerBToken: string
  let customerBId: string
  let addressAId: string
  let addressBId: string
  let categoryId: string

  let pA: string
  let pCheap: string
  let p499: string
  let p498: string
  let pSnap: string
  let pRB: string
  let pDeleted: string
  let pInactive: string

  const ts = Date.now()

  async function createProduct(overrides: Record<string, any>) {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Extended Product ${Math.random().toString(36).slice(2, 8)}`,
        slug: `extended-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        sku: `SKU-EXT-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        categoryId,
        price: 300,
        mrp: 400,
        stock: 50,
        ...overrides,
      })
    return res.body.id || res.body.product?.id || res.body.data?.id
  }

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    const regA = await AuthService.register({
      fullName: 'Alice Extended',
      email: `extended.alice.${ts}@vedhicfoods.com`,
      password: 'AliceExtended@Vedhic2026!',
    })
    customerAToken = regA.accessToken
    customerAId = regA.user.id

    const regB = await AuthService.register({
      fullName: 'Bob Extended',
      email: `extended.bob.${ts}@vedhicfoods.com`,
      password: 'BobExtended@Vedhic2026!',
    })
    customerBToken = regB.accessToken
    customerBId = regB.user.id

    const catRes = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Extended Category ${ts}`, slug: `extended-cat-${ts}` })
    categoryId = catRes.body.id || catRes.body.category?.id || catRes.body.data?.id

    pA = await createProduct({ name: `Coupon Base ${ts}`, price: 400, mrp: 500, stock: 100 })
    pCheap = await createProduct({ name: `Email Probe ${ts}`, price: 100, mrp: 120, stock: 50 })
    p499 = await createProduct({ name: `Threshold 499 ${ts}`, price: 499, mrp: 599, stock: 10 })
    p498 = await createProduct({ name: `Threshold 498 ${ts}`, price: 498, mrp: 599, stock: 10 })
    pSnap = await createProduct({ name: `Snapshot Price ${ts}`, price: 300, mrp: 350, stock: 10 })
    pRB = await createProduct({ name: `Rollback Probe ${ts}`, price: 100, mrp: 120, stock: 5 })
    pDeleted = await createProduct({ name: `Deleted Probe ${ts}`, price: 150, mrp: 180, stock: 10 })
    pInactive = await createProduct({ name: `Inactive Probe ${ts}`, price: 150, mrp: 180, stock: 10 })

    // Soft-delete one product and deactivate another, out-of-band.
    await prisma.product.update({
      where: { id: pDeleted },
      data: { isDeleted: true, deletedAt: new Date() },
    })
    await prisma.product.update({ where: { id: pInactive }, data: { isActive: false } })

    const addrARes = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        fullName: 'Alice Extended',
        phone: '9876500001',
        line1: '12 Extended Street',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
      })
    addressAId = addrARes.body.data.id

    const addrBRes = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        fullName: 'Bob Extended',
        phone: '9876500002',
        line1: '34 Extended Ave',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      })
    addressBId = addrBRes.body.data.id
  }, 120000)

  afterAll(async () => {
    const userIds = [customerAId, customerBId]
    const productIds = [pA, pCheap, p499, p498, pSnap, pRB, pDeleted, pInactive]

    await prisma.deliveryHistory.deleteMany({ where: { delivery: { order: { userId: { in: userIds } } } } }).catch(() => {})
    await prisma.delivery.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
    await prisma.couponUsage.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
    await prisma.coupon.deleteMany({ where: { code: { contains: `EXT${ts}` } } }).catch(() => {})
  }, 120000)

  const post = (token: string) =>
    request(app).post('/api/v1/checkout').set('Authorization', `Bearer ${token}`)

  // -------------------------------------------------------------------------
  // 1. VALIDATION MATRIX
  // -------------------------------------------------------------------------
  describe('1. Request validation, product availability & address gates', () => {
    it('rejects a request with neither addressId nor address payload (400)', async () => {
      const res = await post(customerAToken).send({ items: [{ productId: pA, quantity: 1 }] })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/addressId or an address/i)
    })

    it('rejects a malformed addressId (400)', async () => {
      const res = await post(customerAToken).send({
        addressId: 'not-a-uuid',
        items: [{ productId: pA, quantity: 1 }],
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/address ID format/i)
    })

    it('rejects an inline address missing required fields (400)', async () => {
      const res = await post(customerAToken).send({
        address: { fullName: 'Alice', phone: '9876500001', line1: '12 Street', state: 'TS', pincode: '500081' },
        items: [{ productId: pA, quantity: 1 }],
      })
      expect(res.status).toBe(400)
    })

    it('rejects a non-positive item quantity at the schema layer (400)', async () => {
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 0 }],
      })
      expect(res.status).toBe(400)
    })

    it('rejects checkout of a soft-deleted product (404)', async () => {
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pDeleted, quantity: 1 }],
      })
      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/not found|no longer available/i)
    })

    it('rejects checkout of an unpublished / inactive product (400)', async () => {
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pInactive, quantity: 1 }],
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/unavailable/i)
    })

    it('rejects checkout using another customer address (403)', async () => {
      const res = await post(customerAToken).send({
        addressId: addressBId,
        items: [{ productId: pA, quantity: 1 }],
      })
      expect(res.status).toBe(403)
    })
  })

  // -------------------------------------------------------------------------
  // 2. PRICING ENGINE: SHIPPING THRESHOLD, TAX, SNAPSHOTS
  // -------------------------------------------------------------------------
  describe('2. Authoritative pricing engine', () => {
    it('charges shipping below ₹499 and makes it free at exactly ₹499', async () => {
      const below = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: p498, quantity: 1 }],
        paymentMethod: 'COD',
      })
      expect(below.status).toBe(201)
      expect(below.body.subtotal).toBe(498)
      expect(below.body.shipping).toBe(49)
      expect(below.body.tax).toBe(24.9) // 5% of 498
      expect(below.body.total).toBe(571.9)

      const at = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: p499, quantity: 1 }],
        paymentMethod: 'COD',
      })
      expect(at.status).toBe(201)
      expect(at.body.subtotal).toBe(499)
      expect(at.body.shipping).toBe(0)
      expect(at.body.tax).toBe(24.95) // 5% of 499
      expect(at.body.total).toBe(523.95)
    })

    it('computes tax on the discounted amount, not the gross subtotal', async () => {
      const code = `EXT${ts}PCT`
      await prisma.coupon.create({
        data: {
          code,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          maxDiscount: 50,
          minOrderValue: 0,
          maxUses: 100,
          perUserLimit: 5,
          isActive: true,
        },
      })

      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }], // 400
        couponCode: code,
        paymentMethod: 'COD',
      })

      expect(res.status).toBe(201)
      expect(res.body.discount).toBe(40) // 10% of 400
      expect(res.body.tax).toBe(18) // 5% of (400 - 40)
      expect(res.body.shipping).toBe(49)
      expect(res.body.total).toBe(427) // 360 + 49 + 18
      expect(res.body.couponCode).toBe(code)

      // Usage is recorded and the global counter advanced exactly once.
      const coupon = await prisma.coupon.findUnique({ where: { code } })
      expect(coupon?.usedCount).toBe(1)
      const usage = await prisma.couponUsage.findFirst({
        where: { couponId: coupon!.id, userId: customerAId },
      })
      expect(usage).not.toBeNull()
      expect(Number(usage!.discountApplied)).toBe(40)
    })

    it('caps a fixed-amount coupon at the eligible subtotal', async () => {
      const code = `EXT${ts}FLAT`
      await prisma.coupon.create({
        data: {
          code,
          discountType: 'FIXED_AMOUNT',
          discountValue: 999,
          minOrderValue: 0,
          maxUses: 100,
          perUserLimit: 5,
          isActive: true,
        },
      })

      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: code,
        paymentMethod: 'COD',
      })

      expect(res.status).toBe(201)
      expect(res.body.discount).toBe(400) // capped, never exceeds subtotal
      expect(res.body.tax).toBe(0)
      expect(res.body.total).toBe(49) // 0 + 49 shipping + 0 tax
    })

    it('preserves the product price snapshot when the catalogue price later changes', async () => {
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pSnap, quantity: 2 }], // 2 * 300
        paymentMethod: 'COD',
      })
      expect(res.status).toBe(201)
      const orderNumber = res.body.orderNumber
      expect(res.body.subtotal).toBe(600)
      expect(res.body.items[0].price).toBe(300)

      await prisma.product.update({ where: { id: pSnap }, data: { price: 999 } })

      const orderRes = await request(app)
        .get(`/api/v1/orders/${orderNumber}`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(orderRes.status).toBe(200)
      const order = orderRes.body.order || orderRes.body.data || orderRes.body
      const items = order.items || orderRes.body.items
      // Decimal columns serialise as strings over JSON.
      expect(Number(items[0].price)).toBe(300)
      expect(Number(order.subtotal)).toBe(600)
    })

    it('generates unique VF-YYYY-NNNNNN order numbers across repeated checkouts', async () => {
      const numbers: string[] = []
      for (let i = 0; i < 3; i++) {
        const res = await post(customerAToken).send({
          addressId: addressAId,
          items: [{ productId: pCheap, quantity: 1 }],
          paymentMethod: 'COD',
        })
        expect(res.status).toBe(201)
        numbers.push(res.body.orderNumber)
      }
      numbers.forEach((n) => expect(n).toMatch(/^VF-\d{4}-\d{6}$/))
      expect(new Set(numbers).size).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // 3. COUPON AUTHORING SURFACE (GATING)
  // -------------------------------------------------------------------------
  describe('3. Coupon eligibility gates', () => {
    it('rejects an unknown coupon code (400)', async () => {
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: `EXT${ts}NOPE`,
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid/i)
    })

    it('rejects a disabled coupon (400)', async () => {
      const code = `EXT${ts}OFF`
      await prisma.coupon.create({
        data: { code, discountType: 'PERCENTAGE', discountValue: 10, isActive: false, maxUses: 10, perUserLimit: 1 },
      })
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: code,
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/disabled/i)
    })

    it('rejects a coupon that has expired (400)', async () => {
      const code = `EXT${ts}EXP`
      await prisma.coupon.create({
        data: {
          code,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          expiresAt: new Date(Date.now() - 86400000),
          isActive: true,
          maxUses: 10,
          perUserLimit: 1,
        },
      })
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: code,
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/expired/i)
    })

    it('rejects a coupon that has not started yet (400)', async () => {
      const code = `EXT${ts}FUT`
      await prisma.coupon.create({
        data: {
          code,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date(Date.now() + 86400000),
          isActive: true,
          maxUses: 10,
          perUserLimit: 1,
        },
      })
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: code,
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/not started/i)
    })

    it('rejects a coupon that is not applicable to any cart item (400)', async () => {
      const code = `EXT${ts}RESTRICT`
      const coupon = await prisma.coupon.create({
        data: { code, discountType: 'PERCENTAGE', discountValue: 20, isActive: true, maxUses: 10, perUserLimit: 1 },
      })
      await prisma.couponProduct.create({ data: { couponId: coupon.id, productId: pCheap } })

      // Cart contains only pA, which is outside the coupon's product restriction.
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: code,
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/not applicable/i)
    })

    it('enforces the per-user usage limit on the second checkout', async () => {
      const code = `EXT${ts}ONCE`
      await prisma.coupon.create({
        data: { code, discountType: 'PERCENTAGE', discountValue: 5, isActive: true, maxUses: 100, perUserLimit: 1 },
      })

      const first = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: code,
        paymentMethod: 'COD',
      })
      expect(first.status).toBe(201)

      const second = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        couponCode: code,
        paymentMethod: 'COD',
      })
      expect(second.status).toBe(400)
      expect(second.body.error).toMatch(/usage limit/i)
    })
  })

  // -------------------------------------------------------------------------
  // 4. TRANSACTIONAL ROLLBACK & DEPENDENCY RESILIENCE
  // -------------------------------------------------------------------------
  describe('4. Transaction rollback & dependency resilience', () => {
    it('creates no order and mutates no stock when one line exceeds available stock', async () => {
      const beforeOrders = await prisma.order.count({ where: { userId: customerAId } })
      const beforeA = await prisma.product.findUnique({ where: { id: pA } })
      const beforeRB = await prisma.product.findUnique({ where: { id: pRB } })

      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [
          { productId: pA, quantity: 1 },
          { productId: pRB, quantity: 50 }, // pRB has only 5 in stock
        ],
        paymentMethod: 'COD',
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/insufficient stock/i)

      const afterOrders = await prisma.order.count({ where: { userId: customerAId } })
      const afterA = await prisma.product.findUnique({ where: { id: pA } })
      const afterRB = await prisma.product.findUnique({ where: { id: pRB } })

      expect(afterOrders).toBe(beforeOrders)
      expect(afterA!.stock).toBe(beforeA!.stock)
      expect(afterRB!.stock).toBe(beforeRB!.stock)
    })

    it('still completes the order when the confirmation email transport fails', async () => {
      const spy = vi
        .spyOn(EmailService, 'sendOrderConfirmation')
        .mockRejectedValueOnce(new Error('smtp transport down'))

      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pCheap, quantity: 1 }],
        paymentMethod: 'COD',
      })
      spy.mockRestore()

      expect(res.status).toBe(201)
      const order = await prisma.order.findUnique({ where: { orderNumber: res.body.orderNumber } })
      expect(order).not.toBeNull()
    })

    it('rolls back the transaction and creates nothing when a mid-transaction step fails', async () => {
      const beforeOrders = await prisma.order.count({ where: { userId: customerAId } })
      const beforeCheap = await prisma.product.findUnique({ where: { id: pCheap } })

      // A failure after the transaction has opened must abort the whole unit of
      // work: the order row, payment row, delivery row and reservation must all
      // be rolled back together rather than leaving a partial checkout behind.
      const spy = vi
        .spyOn(InventoryService, 'reserveStock')
        .mockRejectedValueOnce(new Error('database connection terminated'))

      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pCheap, quantity: 1 }],
        paymentMethod: 'COD',
      })
      spy.mockRestore()

      expect(res.status).toBe(500)
      const afterOrders = await prisma.order.count({ where: { userId: customerAId } })
      const afterCheap = await prisma.product.findUnique({ where: { id: pCheap } })
      expect(afterOrders).toBe(beforeOrders)
      expect(afterCheap!.stock).toBe(beforeCheap!.stock)
    })

    it('sends the confirmation email with correct item names and totals', async () => {
      const spy = vi
        .spyOn(EmailService, 'sendOrderConfirmation')
        .mockResolvedValue(undefined as any)

      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pCheap, quantity: 2 }],
        paymentMethod: 'COD',
      })
      expect(res.status).toBe(201)

      expect(spy).toHaveBeenCalledTimes(1)
      const payload = spy.mock.calls[0][0] as any
      expect(payload.items[0].name).toBe(`Email Probe ${ts}`)
      expect(payload.items[0].quantity).toBe(2)
      expect(payload.items[0].price).toBe(100)
      expect(payload.items[0].total).toBe(200)
      spy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // 5. SERVER-AUTHORITATIVE STATE (CLIENT TAMPER RESISTANCE)
  // -------------------------------------------------------------------------
  describe('5. Client cannot dictate server-computed state', () => {
    it('ignores client-supplied status, paymentStatus, stock and totals', async () => {
      const res = await post(customerAToken).send({
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        paymentMethod: 'COD',
        // Everything below is fabricated and must be discarded.
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        stock: 0,
        price: 1,
        subtotal: 1,
        discount: 5000,
        total: 1,
      })

      expect(res.status).toBe(201)
      expect(res.body.status).toBe(OrderStatus.CONFIRMED)
      expect(res.body.paymentStatus).toBe(PaymentStatus.PENDING)
      expect(res.body.subtotal).toBe(400)
      expect(res.body.discount).toBe(0)
      expect(res.body.total).toBe(469) // 400 + 49 + 20
    })
  })

  // -------------------------------------------------------------------------
  // 6. IDEMPOTENCY: CROSS-ACCOUNT REUSE & CONCURRENCY
  // -------------------------------------------------------------------------
  describe('6. Idempotency hardening', () => {
    it('refuses to replay another account\'s order for a reused idempotency key (409)', async () => {
      const key = `shared-key-${ts}`
      const first = await post(customerAToken)
        .set('X-Idempotency-Key', key)
        .send({
          addressId: addressAId,
          items: [{ productId: pA, quantity: 1 }],
          paymentMethod: 'COD',
        })
      expect(first.status).toBe(201)
      const ownerOrderNumber = first.body.orderNumber

      const intruder = await post(customerBToken)
        .set('X-Idempotency-Key', key)
        .send({
          addressId: addressBId,
          items: [{ productId: pA, quantity: 1 }],
          paymentMethod: 'COD',
        })

      expect(intruder.status).toBe(409)
      expect(JSON.stringify(intruder.body)).not.toContain(ownerOrderNumber)
      expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1)
    })

    it('resolves a concurrent double-submit into a single order and single replay', async () => {
      const key = `concurrent-key-${ts}`
      const body = {
        addressId: addressAId,
        items: [{ productId: pA, quantity: 1 }],
        paymentMethod: 'COD',
      }

      const [r1, r2] = await Promise.all([
        post(customerAToken).set('X-Idempotency-Key', key).send(body),
        post(customerAToken).set('X-Idempotency-Key', key).send(body),
      ])

      const statuses = [r1.status, r2.status].sort()
      expect(statuses.every((s) => s === 200 || s === 201)).toBe(true)
      expect(statuses).toContain(201)
      expect(r1.body.orderNumber).toBe(r2.body.orderNumber)

      const orders = await prisma.order.findMany({ where: { idempotencyKey: key } })
      expect(orders).toHaveLength(1)
    })
  })
})
