import './_safety'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { isCodEnabled } from '../../src/utils/cod-settings'
import { SettingCategory } from '@prisma/client'

const app = createApp()

const COD_UNAVAILABLE =
  'Cash on Delivery is not available right now. Please choose an online payment method.'

describe('Admin-controlled Cash-on-Delivery policy', () => {
  const ts = Date.now()

  let customerToken: string
  let customerId: string
  let customerEmail: string
  let guestEmail: string
  let addressId: string
  let categoryId: string
  let productId: string
  let productSlug: string

  let originalSetting: {
    value: string
    category: SettingCategory
    description: string | null
    isPublic: boolean
    updatedBy: string | null
  } | null = null
  let originalPaymentCodEnabled: boolean | undefined

  async function setCodSetting(value: string): Promise<void> {
    await prisma.systemSetting.upsert({
      where: { key: 'shipping_cod_enabled' },
      update: { value },
      create: {
        key: 'shipping_cod_enabled',
        value,
        category: SettingCategory.SHIPPING,
        description: 'Whether Cash on Delivery is offered at storefront checkout',
        isPublic: true,
      },
    })
  }

  async function removeCodSetting(): Promise<void> {
    await prisma.systemSetting.deleteMany({ where: { key: 'shipping_cod_enabled' } })
  }

  async function setPaymentCod(enabled: boolean): Promise<void> {
    await prisma.paymentSettings.upsert({
      where: { id: 'default' },
      update: { codEnabled: enabled },
      create: { id: 'default', codEnabled: enabled },
    })
  }

  async function restoreBaseline(): Promise<void> {
    if (originalSetting) {
      const data = {
        value: originalSetting.value,
        category: originalSetting.category,
        description: originalSetting.description,
        isPublic: originalSetting.isPublic,
        updatedBy: originalSetting.updatedBy,
      }
      await prisma.systemSetting.upsert({
        where: { key: 'shipping_cod_enabled' },
        update: data,
        create: { key: 'shipping_cod_enabled', ...data },
      })
    } else {
      await removeCodSetting()
    }
    if (originalPaymentCodEnabled !== undefined) {
      await setPaymentCod(originalPaymentCodEnabled)
    }
  }

  function authedCheckout(body: Record<string, unknown>) {
    return request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(body)
  }

  function storefrontCheckout(overrides: Record<string, unknown> = {}) {
    return request(app)
      .post('/api/v1/orders/checkout')
      .send({
        customerName: 'Guest COD Probe',
        customerEmail: guestEmail,
        phone: '9876504321',
        addressLine: '7 Cash Street',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
        paymentMethod: 'COD',
        items: [{ productId: productSlug, quantity: 1 }],
        ...overrides,
      })
  }

  function authedCodBody(overrides: Record<string, unknown> = {}) {
    return { addressId, items: [{ productId, quantity: 1 }], paymentMethod: 'COD', ...overrides }
  }

  beforeAll(async () => {
    customerEmail = `cod.customer.${ts}@vedhicfoods.com`
    guestEmail = `cod.guest.${ts}@vedhicfoods.com`

    const reg = await AuthService.register({
      fullName: 'COD Policy Customer',
      email: customerEmail,
      password: 'CodPolicy@Vedhic2026!',
    })
    customerToken = reg.accessToken
    customerId = reg.user.id

    const category = await prisma.category.create({
      data: { name: `COD Category ${ts}`, slug: `cod-cat-${ts}` },
    })
    categoryId = category.id

    productSlug = `cod-probe-${ts}`
    const product = await prisma.product.create({
      data: {
        name: `COD Probe ${ts}`,
        slug: productSlug,
        sku: `SKU-COD-${ts}`,
        categoryId,
        price: 250,
        mrp: 300,
        stock: 100,
      },
    })
    productId = product.id

    const addrRes = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        fullName: 'COD Policy Customer',
        phone: '9876501111',
        line1: '10 Policy Avenue',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
      })
    addressId = addrRes.body.data.id

    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'shipping_cod_enabled' },
    })
    originalSetting = setting
      ? {
          value: setting.value,
          category: setting.category,
          description: setting.description,
          isPublic: setting.isPublic,
          updatedBy: setting.updatedBy,
        }
      : null

    const payment = await prisma.paymentSettings.findUnique({ where: { id: 'default' } })
    originalPaymentCodEnabled = payment?.codEnabled
  }, 120000)

  afterEach(async () => {
    await restoreBaseline()
  })

  afterAll(async () => {
    await restoreBaseline()

    const guest = await prisma.user.findUnique({ where: { email: guestEmail } })
    const userIds = [customerId, ...(guest ? [guest.id] : [])]
    const productIds = [productId]

    await prisma.deliveryHistory
      .deleteMany({ where: { delivery: { order: { userId: { in: userIds } } } } })
      .catch(() => {})
    await prisma.delivery
      .deleteMany({ where: { order: { userId: { in: userIds } } } })
      .catch(() => {})
    await prisma.inventoryLog
      .deleteMany({ where: { productId: { in: productIds } } })
      .catch(() => {})
    await prisma.orderItem
      .deleteMany({ where: { order: { userId: { in: userIds } } } })
      .catch(() => {})
    await prisma.payment
      .deleteMany({ where: { order: { userId: { in: userIds } } } })
      .catch(() => {})
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
  }, 120000)

  describe('1. COD accepted when the public setting is true', () => {
    it('creates an order over the authenticated checkout endpoint', async () => {
      await setCodSetting('true')

      const res = await authedCheckout(authedCodBody())

      expect(res.status).toBe(201)
      expect(res.body.paymentMethod).toBe('COD')

      const order = await prisma.order.findUnique({ where: { orderNumber: res.body.orderNumber } })
      expect(order).not.toBeNull()
      expect(order?.paymentMethod).toBe('COD')
    })

    it('creates an order over the guest storefront adapter', async () => {
      await setCodSetting('true')

      const res = await storefrontCheckout()

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.paymentMethod).toBe('COD')
    })
  })

  describe('2. COD rejected when the public setting is false', () => {
    it('rejects the authenticated checkout with 400 and the exact message', async () => {
      await setCodSetting('false')

      const before = await prisma.order.count()
      const res = await authedCheckout(authedCodBody())

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(COD_UNAVAILABLE)
      expect(await prisma.order.count()).toBe(before)
    })

    it('rejects the guest storefront adapter with 400 and the exact message', async () => {
      await setCodSetting('false')

      const before = await prisma.order.count()
      const res = await storefrontCheckout()

      expect(res.status).toBe(400)
      expect(res.body.error).toBe(COD_UNAVAILABLE)
      expect(await prisma.order.count()).toBe(before)
    })
  })

  describe('3. Fallback to PaymentSettings.codEnabled when the public setting is absent', () => {
    it('rejects COD when the fallback flag is disabled', async () => {
      await removeCodSetting()
      await setPaymentCod(false)

      expect(await isCodEnabled()).toBe(false)

      const res = await authedCheckout(authedCodBody())
      expect(res.status).toBe(400)
      expect(res.body.error).toBe(COD_UNAVAILABLE)
    })

    it('accepts COD when the fallback flag is enabled', async () => {
      await removeCodSetting()
      await setPaymentCod(true)

      expect(await isCodEnabled()).toBe(true)

      const res = await authedCheckout(authedCodBody())
      expect(res.status).toBe(201)
      expect(res.body.paymentMethod).toBe('COD')
    })
  })

  describe('4. Razorpay proceeds while COD is disabled', () => {
    it('still creates an online-payment order over the authenticated endpoint', async () => {
      await setCodSetting('false')

      const res = await authedCheckout({
        addressId,
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'RAZORPAY',
      })

      expect(res.status).toBe(201)
      expect(res.body.paymentMethod).toBe('RAZORPAY')
      expect(res.body.status).toBe('PENDING_PAYMENT')
    })

    it('still creates an online-payment order over the guest storefront adapter', async () => {
      await setCodSetting('false')

      const res = await storefrontCheckout({ paymentMethod: 'RAZORPAY' })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.paymentMethod).toBe('RAZORPAY')
    })
  })

  describe('5. isCodEnabled() parity with the checkout gate', () => {
    it('is true and COD succeeds when the setting parses truthy', async () => {
      await setCodSetting('true')

      expect(await isCodEnabled()).toBe(true)
      const res = await authedCheckout(authedCodBody())
      expect(res.status).toBe(201)
    })

    it('is false and COD is rejected when the setting parses falsy', async () => {
      await setCodSetting('false')

      expect(await isCodEnabled()).toBe(false)
      const res = await authedCheckout(authedCodBody())
      expect(res.status).toBe(400)
      expect(res.body.error).toBe(COD_UNAVAILABLE)
    })

    it('treats truthy spellings as enabled', async () => {
      for (const value of ['TRUE', '1', 'yes']) {
        await setCodSetting(value)
        expect(await isCodEnabled()).toBe(true)
      }
    })

    it('treats falsy spellings as disabled', async () => {
      for (const value of ['0', 'no', 'False', '']) {
        await setCodSetting(value)
        expect(await isCodEnabled()).toBe(false)
      }
    })
  })
})
