import './_safety'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { RoleName, PaymentMethod, OrderStatus, PaymentStatus } from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { CheckoutService } from '../../src/services/checkout.service'
import { AuditService } from '../../src/services/audit.service'
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'

const app = createApp()
const API = '/api/v1'

const stamp = Date.now()
const TAG = String(stamp)
const ADMIN_EMAIL = 'admin@vedhicfoods.com'
const ADMIN_PASSWORD = 'Admin@Vedhic2026'
const PASSWORD = 'Password@123'
const uniq = (tag: string) => `${TAG}-${tag}-${Math.floor(Math.random() * 1e6)}`
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

// Rows written by this suite, removed precisely in afterAll.
const createdAuditIds: string[] = []
const createdOrderIds: string[] = []
const createdStaffIds: string[] = []
const createdCustomerIds: string[] = []
const productIds: string[] = []
const categoryIds: string[] = []
const createdInvoiceIds: string[] = []

let adminToken: string
let adminId: string
let coffee: { id: string; email: string; token: string }
let suiteProductId: string
let suiteCategoryId: string
let _emailSpy: ReturnType<typeof vi.spyOn>

async function findAudits(where: Record<string, unknown>): Promise<any[]> {
  return prisma.auditLog.findMany({ where: where as any, orderBy: { createdAt: 'desc' } })
}

function trackAudits(rows: any[]): void {
  for (const r of rows) createdAuditIds.push(r.id)
}

async function createStaff(email: string, withPermissionSlug?: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: RoleName.STAFF } })
  if (!role) throw new Error('STAFF role is not seeded')
  const u = await prisma.user.create({
    data: {
      email,
      fullName: `Audit Staff ${email}`,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      role: RoleName.STAFF,
      isActive: true,
      isVerified: true,
    },
  })
  await prisma.userRole.create({ data: { userId: u.id, roleId: role.id, assignedBy: 'AUDIT_SUITE' } })
  createdStaffIds.push(u.id)
  if (withPermissionSlug) {
    const perm = await prisma.permission.findUnique({ where: { slug: withPermissionSlug } })
    if (perm) {
      await prisma.userPermission.create({ data: { userId: u.id, permissionId: perm.id, assignedBy: 'AUDIT_SUITE' } })
    }
  }
  return u.id
}

/** A STAFF whose UserRole-derived grants resolve to zero (passes the role gate, holds nothing). */
async function createStaffWithoutRole(email: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email,
      fullName: `Audit Staff ${email}`,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      role: RoleName.STAFF,
      isActive: true,
      isVerified: true,
    },
  })
  createdStaffIds.push(u.id)
  return u.id
}

function checkoutInput(productId: string, suffix: string) {
  return {
    address: {
      fullName: 'Audit Customer',
      phone: '9812345678',
      line1: 'Test Road',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500001',
      country: 'India',
    },
    items: [{ productId, quantity: 2 }],
    idempotencyKey: `audit-${suffix}`,
  }
}

async function destroyOrder(orderId: string): Promise<void> {
  await prisma.deliveryHistory.deleteMany({ where: { delivery: { orderId } } }).catch(() => {})
  await prisma.delivery.deleteMany({ where: { orderId } }).catch(() => {})
  await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {})
  await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {})
  await prisma.invoice.deleteMany({ where: { orderId } }).catch(() => {})
  await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {})
}

describe('Audit Logging & Trail Integrity', () => {
  beforeAll(async () => {
    _emailSpy = vi
      .spyOn(BrevoEmailService, 'sendTransactionalEmail')
      .mockResolvedValue('audit-suite-msg-id')

    const adminLogin = await request(app)
      .post(`${API}/admin/auth/login`)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    expect(adminLogin.status).toBe(200)
    adminToken = adminLogin.body.accessToken
    const adminRow = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })
    adminId = adminRow!.id

    const reg = await AuthService.register({
      fullName: 'Audit Coffee Customer',
      email: `audit.coffee.${TAG}@vedhicfoods.com`,
      password: 'Password@1234',
    })
    coffee = { id: reg.user.id, email: reg.user.email, token: reg.accessToken }
    createdCustomerIds.push(coffee.id)

    const suffix = Math.floor(Math.random() * 1e9)
    const category = await prisma.category.create({
      data: { name: `Audit Cat ${suffix}`, slug: `audit-cat-${suffix}` },
    })
    suiteCategoryId = category.id
    categoryIds.push(category.id)
    const product = await prisma.product.create({
      data: {
        name: `Audit Product ${suffix}`,
        slug: `audit-prod-${suffix}`,
        sku: `SKU-AUDIT-${suffix}`,
        categoryId: category.id,
        price: 100,
        mrp: 120,
        stock: 100,
      },
    })
    void suiteCategoryId
    suiteProductId = product.id
    productIds.push(product.id)
  })

  afterAll(async () => {
    for (const id of new Set(createdOrderIds)) await destroyOrder(id)

    await prisma.notification.deleteMany({
      where: { userId: { in: createdCustomerIds } },
    }).catch(() => {})

    for (const id of new Set(createdStaffIds)) {
      await prisma.userPermission.deleteMany({ where: { userId: id } }).catch(() => {})
      await prisma.userRole.deleteMany({ where: { userId: id } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id } }).catch(() => {})
    }

    await prisma.userPermission.deleteMany({ where: { userId: { in: createdCustomerIds } } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: createdCustomerIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {})

    await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } }).catch(() => {})

    await prisma.auditLog.deleteMany({ where: { id: { in: [...new Set(createdAuditIds)] } } }).catch(() => {})

    for (const id of createdInvoiceIds) {
      await prisma.invoice.deleteMany({ where: { id } }).catch(() => {})
    }
  })

  // ==========================================================================
  // 1. AUTHENTICATION AUDIT COVERAGE
  // ==========================================================================
  describe('authentication & password audit coverage', () => {
    it('admin login via the API records USER_LOGIN with full attribution', async () => {
      const res = await request(app)
        .post(`${API}/admin/auth/login`)
        .set('User-Agent', 'audit-suite/1.0')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      expect(res.status).toBe(200)

      const logs = await findAudits({ actorEmail: ADMIN_EMAIL.toLowerCase(), action: 'USER_LOGIN' })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      const log = logs.find((l) => l.userAgent === 'audit-suite/1.0') ?? logs[0]
      expect(log.actorId).toBeTruthy()
      expect(log.action).toBe('USER_LOGIN')
      expect(log.entity).toBe('User')
      expect(log.requestId).toBeTruthy()
      expect(log.ipAddress).toBeTruthy()
      expect(log.userAgent).toBeTruthy()
      // The credential must never survive into the trail.
      expect(JSON.stringify(log)).not.toContain(ADMIN_PASSWORD)
    })

    it('registration writes USER_REGISTERED with actor attribution', async () => {
      const email = `audit.reg.${uniq('r')}@vedhicfoods.com`
      const reg = await AuthService.register({ fullName: 'Audit Reg', email, password: 'Password@1234' })
      createdCustomerIds.push(reg.user.id)
      const logs = await findAudits({ entityId: reg.user.id, action: 'USER_REGISTERED' })
      expect(logs).toHaveLength(1)
      trackAudits(logs)
      expect(logs[0].actorId).toBe(reg.user.id)
      expect(logs[0].metadata.role).toBe(RoleName.CUSTOMER)
    })

    it('changing my password writes PASSWORD_CHANGED and never stores the new value', async () => {
      const email = `audit.pw.${uniq('p')}@vedhicfoods.com`
      const reg = await AuthService.register({ fullName: 'Audit Pw', email, password: 'Password@1234' })
      createdCustomerIds.push(reg.user.id)

      const res = await request(app)
        .put(`${API}/auth/change-password`)
        .set(auth(reg.accessToken))
        .send({ currentPassword: 'Password@1234', newPassword: 'Rotated@5678' })
      expect(res.status).toBe(200)

      const logs = await findAudits({ actorId: reg.user.id, action: 'PASSWORD_CHANGED' })
      expect(logs).toHaveLength(1)
      trackAudits(logs)
      expect(JSON.stringify(logs[0])).not.toContain('Rotated@5678')
    })

    it('logout via the API writes USER_LOGOUT', async () => {
      const email = `audit.out.${uniq('o')}@vedhicfoods.com`
      const reg = await AuthService.register({ fullName: 'Audit Out', email, password: 'Password@1234' })
      createdCustomerIds.push(reg.user.id)

      const logout = await request(app)
        .post(`${API}/auth/logout`)
        .set(auth(reg.accessToken))
        .send({ refreshToken: reg.refreshToken })
      expect(logout.status).toBe(200)

      const logs = await findAudits({ actorId: reg.user.id, action: 'USER_LOGOUT' })
      expect(logs.length).toBeGreaterThanOrEqual(1)
      trackAudits(logs)
    })
  })

  // ==========================================================================
  // 2. ORDER LIFECYCLE AUDIT COVERAGE (the gaps this pass closed)
  // ==========================================================================
  describe('order lifecycle audit coverage', () => {
    it('checkout writes ORDER_CREATED and DELIVERY_CREATED atomically, with the customer as actor', async () => {
      const result = await CheckoutService.processCheckout(coffee.id, {
        ...checkoutInput(suiteProductId, uniq('co')),
        paymentMethod: PaymentMethod.COD,
      })
      expect(result.isIdempotentReplay).toBe(false)
      const orderId = result.response.orderId
      createdOrderIds.push(orderId)

      const createdLogs = await findAudits({ entityId: orderId, action: 'ORDER_CREATED' })
      expect(createdLogs).toHaveLength(1)
      trackAudits(createdLogs)
      const log = createdLogs[0]
      expect(log.actorId).toBe(coffee.id)
      expect(log.actorEmail).toBe(coffee.email)
      expect(log.entity).toBe('Order')
      expect(log.metadata).toMatchObject({
        orderNumber: result.response.orderNumber,
        status: 'CONFIRMED',
        paymentMethod: 'COD',
      })

      const deliveryLogs = await prisma.auditLog.findMany({
        where: { action: 'DELIVERY_CREATED', entity: 'Delivery' },
      })
      const deliveryLog = deliveryLogs.find((l) => (l.metadata as any)?.orderId === orderId)
      expect(deliveryLog).toBeDefined()
      trackAudits([deliveryLog!])
      expect(deliveryLog!.metadata.status).toBe('PENDING')
    })

    it('an idempotent checkout replay does not duplicate ORDER_CREATED', async () => {
      const key = `audit-replay-${uniq('re')}`
      const first = await CheckoutService.processCheckout(coffee.id, {
        ...checkoutInput(suiteProductId, key),
        paymentMethod: PaymentMethod.COD,
      })
      createdOrderIds.push(first.response.orderId)

      const replay = await CheckoutService.processCheckout(coffee.id, {
        ...checkoutInput(suiteProductId, key),
        paymentMethod: PaymentMethod.COD,
      })
      expect(replay.isIdempotentReplay).toBe(true)
      expect(replay.response.orderId).toBe(first.response.orderId)
      const rows = await findAudits({ entityId: first.response.orderId, action: 'ORDER_CREATED' })
      expect(rows).toHaveLength(1)
    })

    it('cancelling an order writes ORDER_CANCELLED with previous status and reason', async () => {
      const result = await CheckoutService.processCheckout(coffee.id, {
        ...checkoutInput(suiteProductId, uniq('cc')),
        paymentMethod: PaymentMethod.COD,
      })
      const orderId = result.response.orderId
      createdOrderIds.push(orderId)

      const res = await request(app)
        .post(`${API}/orders/${orderId}/cancel`)
        .set(auth(coffee.token))
        .send({ reason: 'Audit suite cancellation' })
      expect(res.status).toBe(200)

      const logs = await findAudits({ entityId: orderId, action: 'ORDER_CANCELLED' })
      expect(logs).toHaveLength(1)
      trackAudits(logs)
      expect(logs[0].metadata).toMatchObject({
        orderNumber: result.response.orderNumber,
        previousStatus: 'CONFIRMED',
        reason: 'Audit suite cancellation',
      })
      expect(logs[0].actorId).toBe(coffee.id)
    })

    it('an admin state-machine transition writes ORDER_STATUS_UPDATED', async () => {
      const result = await CheckoutService.processCheckout(coffee.id, {
        ...checkoutInput(suiteProductId, uniq('tr')),
        paymentMethod: PaymentMethod.COD,
      })
      const orderId = result.response.orderId
      createdOrderIds.push(orderId)

      const res = await request(app)
        .put(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: OrderStatus.PROCESSING })
      expect(res.status).toBe(200)

      const logs = await findAudits({ entityId: orderId, action: 'ORDER_STATUS_UPDATED' })
      expect(logs).toHaveLength(1)
      trackAudits(logs)
      expect(logs[0].metadata).toMatchObject({ previousStatus: 'CONFIRMED', newStatus: 'PROCESSING' })
      expect(logs[0].actorId).toBe(adminId)
    })

    it('marking a payment failed writes ORDER_PAYMENT_FAILED', async () => {
      const result = await CheckoutService.processCheckout(coffee.id, {
        ...checkoutInput(suiteProductId, uniq('pf')),
        paymentMethod: PaymentMethod.RAZORPAY,
      })
      const orderId = result.response.orderId
      createdOrderIds.push(orderId)

      const res = await request(app)
        .post(`${API}/orders/${orderId}/payment-failed`)
        .set(auth(coffee.token))
        .send({ reason: 'User closed the checkout sheet' })
      expect(res.status).toBe(200)

      const logs = await findAudits({ entityId: orderId, action: 'ORDER_PAYMENT_FAILED' })
      expect(logs).toHaveLength(1)
      trackAudits(logs)
      expect(logs[0].metadata).toMatchObject({ reason: 'User closed the checkout sheet' })
      expect(logs[0].actorId).toBe(coffee.id)
    })
  })

  // ==========================================================================
  // 3. STAFF LIFECYCLE AUDIT COVERAGE (incl. distinct reactivation action)
  // ==========================================================================
  describe('staff lifecycle audit coverage', () => {
    it('creating a staff account writes STAFF_CREATED with the actor email and no credential material', async () => {
      const email = `audit.staff1.${TAG}@vedhicfoods.com`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set(auth(adminToken))
        .send({ fullName: 'Audit Staff One', email, password: PASSWORD, role: RoleName.STAFF })
      expect(res.status).toBe(201)
      const staffId = res.body.staff.id
      createdStaffIds.push(staffId)

      const logs = await findAudits({ entityId: staffId, action: 'STAFF_CREATED' })
      expect(logs).toHaveLength(1)
      trackAudits(logs)
      expect(logs[0].actorEmail).toBe(ADMIN_EMAIL)
      expect(logs[0].metadata.staffEmail).toBe(email)
      expect(JSON.stringify(logs[0])).not.toContain(PASSWORD)
    })

    it('disabling writes STAFF_DISABLED; reactivating writes the distinct STAFF_REACTIVATED', async () => {
      const staffId = createdStaffIds[createdStaffIds.length - 1]

      const disable = await request(app)
        .patch(`${API}/admin/staff/${staffId}`)
        .set(auth(adminToken))
        .send({ isActive: false })
      expect(disable.status).toBe(200)
      const disabledLogs = await findAudits({ entityId: staffId, action: 'STAFF_DISABLED' })
      expect(disabledLogs).toHaveLength(1)
      trackAudits(disabledLogs)

      const reactivate = await request(app)
        .patch(`${API}/admin/staff/${staffId}`)
        .set(auth(adminToken))
        .send({ isActive: true })
      expect(reactivate.status).toBe(200)
      // The dedicated action (previously collapsed into STAFF_UPDATED).
      const reactivatedLogs = await findAudits({ entityId: staffId, action: 'STAFF_REACTIVATED' })
      expect(reactivatedLogs).toHaveLength(1)
      trackAudits(reactivatedLogs)
      expect(reactivatedLogs[0].metadata.changes).toMatchObject({ isActive: true })
      expect(reactivatedLogs[0].actorEmail).toBe(ADMIN_EMAIL)

      // Generic STAFF_UPDATED must NOT have been emitted for the reactivation.
      const generic = await findAudits({ entityId: staffId, action: 'STAFF_UPDATED' })
      for (const g of generic) createdAuditIds.push(g.id)
      const reactivationGeneric = generic.find(
        (g) => (g.metadata.changes as any)?.isActive === true
      )
      expect(reactivationGeneric).toBeUndefined()
    })
  })

  // ==========================================================================
  // 4. SECRET REDACTION — NEVER LOG CREDENTIALS
  // ==========================================================================
  describe('secret redaction', () => {
    it('redacts password/token/secret keys at write time via AuditService', async () => {
      await AuditService.record({
        action: 'TEST_SECRET_REDACTION',
        entity: 'Test',
        metadata: {
          password: 'S3cret!',
          refreshToken: 'r-token-123',
          webhookSecret: 'whsec-abc',
          keySecret: 'key-456',
          apiKey: 'ak-789',
          safe: 'ok',
        },
      })
      const row = await prisma.auditLog.findFirst({ where: { action: 'TEST_SECRET_REDACTION' } })
      expect(row).toBeDefined()
      trackAudits([row!])
      expect(row!.metadata).toMatchObject({
        password: '[REDACTED]',
        refreshToken: '[REDACTED]',
        webhookSecret: '[REDACTED]',
        keySecret: '[REDACTED]',
      })
      // `apiKey` is credential-shaped (matches the sanitizer's `apikey`
      // fragment), so redaction is the security-correct behaviour here.
      expect(row!.metadata.apiKey).toBe('[REDACTED]')
      // ...while a genuinely benign key must still survive untouched.
      expect(row!.metadata.safe).toBe('ok')
    })
  })

  // ==========================================================================
  // 5. AUDIT-LOG API: AUTHORIZATION, FILTERS, ROBUSTNESS, IMMUTABILITY
  // ==========================================================================
  describe('audit-logs API security & robustness', () => {
    it('is gated: anonymous 401, customer 403, zero-permission staff 403', async () => {
      const anon = await request(app).get(`${API}/admin/audit-logs`)
      expect(anon.status).toBe(401)

      const customer = await request(app)
        .get(`${API}/admin/audit-logs`)
        .set(auth(coffee.token))
      expect(customer.status).toBe(403)

      const staffNoPermsEmail = `audit.noperm.${uniq('n')}@vedhicfoods.com`
      await createStaffWithoutRole(staffNoPermsEmail)
      const token = (await AuthService.login({ email: staffNoPermsEmail, password: PASSWORD })).accessToken
      const staff = await request(app)
        .get(`${API}/admin/audit-logs`)
        .set(auth(token))
      expect(staff.status).toBe(403)
    })

    it('an OWNER session can read logs and apply action + date filters', async () => {
      const byAction = await request(app)
        .get(`${API}/admin/audit-logs?action=USER_LOGIN`)
        .set(auth(adminToken))
      expect(byAction.status).toBe(200)
      expect(byAction.body.data.length).toBeGreaterThan(0)
      for (const row of byAction.body.data) expect(row.action).toBe('USER_LOGIN')

      const today = new Date().toISOString().slice(0, 10)
      const byDate = await request(app)
        .get(`${API}/admin/audit-logs?from=${today}`)
        .set(auth(adminToken))
      expect(byDate.status).toBe(200)
      for (const row of byDate.body.data) {
        expect(new Date(row.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(`${today}T00:00:00.000Z`).getTime())
      }
    })

    it('malformed or inverted dates are rejected as 400, never a 500', async () => {
      const badFrom = await request(app)
        .get(`${API}/admin/audit-logs?from=not-a-date`)
        .set(auth(adminToken))
      expect(badFrom.status).toBe(400)

      const badTo = await request(app)
        .get(`${API}/admin/audit-logs?to=garbage`)
        .set(auth(adminToken))
      expect(badTo.status).toBe(400)

      const inverted = await request(app)
        .get(`${API}/admin/audit-logs?from=2026-12-31&to=2026-01-01`)
        .set(auth(adminToken))
      expect(inverted.status).toBe(400)

      const future = await request(app)
        .get(`${API}/admin/audit-logs?from=2099-01-01`)
        .set(auth(adminToken))
      expect(future.status).toBe(200)
    })

    it('garbage pagination values are clamped instead of crashing the query', async () => {
      const res = await request(app)
        .get(`${API}/admin/audit-logs?page=abc&limit=99999`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.page).toBe(1)
      expect(res.body.pagination.limit).toBeLessThanOrEqual(100)
    })

    it('the customer list endpoint also survives garbage page values', async () => {
      const res = await request(app)
        .get(`${API}/admin/customers?page=abc&limit=-3`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.pagination.page).toBe(1)
    })

    it('audit logs are immutable over HTTP: no create/update/delete route exists (404)', async () => {
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await (request(app) as any)[method](`${API}/admin/audit-logs`)
          .set(auth(adminToken))
          .send({})
        expect(res.status, `${method.toUpperCase()} answered ${res.status}`).toBe(404)
      }
    })

    it('a staff with audit_logs.read can read but still cannot modify logs (no write routes)', async () => {
      const email = `audit.reader.${uniq('r')}@vedhicfoods.com`
      await createStaff(email, 'audit_logs.read')
      const token = (await AuthService.login({ email, password: PASSWORD })).accessToken

      const read = await request(app)
        .get(`${API}/admin/audit-logs`)
        .set(auth(token))
      expect(read.status).toBe(200)
      expect(Array.isArray(read.body.data)).toBe(true)

      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await (request(app) as any)[method](`${API}/admin/audit-logs`)
          .set(auth(token))
          .send({})
        expect(res.status, `${method.toUpperCase()} answered ${res.status}`).toBe(404)
      }
    })
  })

  // ==========================================================================
  // 6. RECONCILIATION — unpaid-with-invoice vs paid-without-invoice (bug fix)
  // ==========================================================================
  describe('invoice reconciliation summary correctness', () => {
    it('separates unpaid invoices from paid-but-invoiceless orders', async () => {
      const email = `audit.inv.${TAG}@vedhicfoods.com`
      const reg = await AuthService.register({ fullName: 'Audit Inv', email, password: 'Password@1234' })
      createdCustomerIds.push(reg.user.id)
      const userId = reg.user.id

      const unpaidOrder = await prisma.order.create({
        data: {
          orderNumber: `VF-AUDIT-${TAG}-U`,
          userId,
          customerName: 'Audit Inv',
          customerEmail: email,
          phone: '9800000001',
          subtotal: 100,
          total: 100,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
        },
      })
      createdOrderIds.push(unpaidOrder.id)
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: `INV-AUD-${TAG}-U`,
          orderId: unpaidOrder.id,
          userId,
          subtotal: 100,
          total: 100,
        },
      })
      createdInvoiceIds.push(invoice.id)

      const paidWithoutInvoice = await prisma.order.create({
        data: {
          orderNumber: `VF-AUDIT-${TAG}-P`,
          userId,
          customerName: 'Audit Inv',
          customerEmail: email,
          phone: '9800000002',
          subtotal: 200,
          total: 200,
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
        },
      })
      createdOrderIds.push(paidWithoutInvoice.id)

      const from = new Date(Date.now() - 24 * 3600 * 1000)
      const to = new Date(Date.now() + 24 * 3600 * 1000)

      const res = await request(app)
        .get(`${API}/invoices/reconciliation`)
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      const summary = res.body.data.summary

      const rawUnpaid = await prisma.invoice.count({
        where: {
          createdAt: { gte: from, lte: to },
          order: { paymentStatus: { not: PaymentStatus.PAID } },
        },
      })
      const rawPaidWithoutInvoice = await prisma.order.count({
        where: {
          paymentStatus: PaymentStatus.PAID,
          createdAt: { gte: from, lte: to },
          invoiceId: null,
        },
      })

      expect(summary.unpaidWithInvoice).toBe(rawUnpaid)
      expect(summary.paidWithoutInvoice).toBe(rawPaidWithoutInvoice)
      expect(summary.unpaidWithInvoice).toBeGreaterThanOrEqual(1)
      expect(summary.paidWithoutInvoice).toBeGreaterThanOrEqual(1)
    })
  })
})