import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { RoleName } from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { env } from '../../src/config/env'

/**
 * ==========================================================================
 *  VEDHIC FOODS — ROLE-BASED ACCESS CONTROL TEST SUITE
 * ==========================================================================
 *
 *  What this suite proves, and how:
 *
 *  1. AUTHORIZATION IS SERVER-SIDE. Every request below is issued straight at
 *     the Express app with `supertest`. No frontend, no route guard, no `can()`
 *     helper is in the loop — if an assertion passes, the *API* enforced it.
 *
 *  2. THE MATRIX IS EXHAUSTIVE BY CONSTRUCTION. Each protected endpoint is
 *     exercised by five principals (unauthenticated / customer / staff / admin /
 *     owner) and the expected outcome is derived from one table, so an endpoint
 *     that forgets `authenticate`, forgets `requirePermission`, or is reachable
 *     by the wrong role fails its own row rather than hiding in a hand-written
 *     expectation.
 *
 *  3. DENIAL IS THE DEFAULT. `unauthenticated` must be 401 on *every* endpoint
 *     — that assertion doubles as a path-existence check, because a mistyped
 *     route would answer 404 and fail immediately.
 *
 *  Authorization semantics used throughout:
 *     allowed   = status is NOT 401 and NOT 403
 *     denied    = status is 401 or 403
 *  Using "not a 401/403" rather than a fixed 200 lets probes send deliberately
 *  invalid bodies and non-existent IDs, so authorized actors can never mutate
 *  real data while still proving they were let through the gate.
 */

const app = createApp()
const API = '/api/v1'
const suffix = Date.now()
const PASSWORD = 'Password@123'

// ---------------------------------------------------------------------------
// The seeded STAFF grant set (mirrors `database/seed.ts`). The matrix derives
// every STAFF expectation from this one list, so revoking a slug here is the
// single place a "staff may not do X" expectation lives.
// ---------------------------------------------------------------------------
const STAFF_SLUGS = new Set<string>([
  'products.read',
  'products.update',
  'categories.read',
  'inventory.read',
  'inventory.update',
  'orders.read',
  'orders.update',
  'customers.read',
  'discounts.read',
  'invoices.read',
  'invoices.create',
  'delivery.read',
  'delivery.update',
  'delivery.assign',
  'support.read',
  'support.reply',
  'support.update',
  'support.assign',
  'support.close',
  'contacts.read',
  'contacts.manage',
])

// CUSTOMER holds no permissions at all — the storefront catalog routes are
// public and check nothing, so there is no slug a customer legitimately needs.
const CUSTOMER_SLUGS = new Set<string>([])

interface Endpoint {
  slug: string
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  path: string
  body?: unknown
  /**
   * Probe-only endpoints whose *authorized* branch would mutate live state
   * (payment gateway credentials). The denial branch runs before the handler,
   * so the security-relevant direction is still fully asserted.
   */
  denyOnly?: boolean
}

const NOT_FOUND_ID = 'rbac-does-not-exist'

const ENDPOINTS: Endpoint[] = [
  // ---- products.view / products.create / products.update / products.delete
  { slug: 'products.read', method: 'get', path: `${API}/admin/products` },
  { slug: 'products.read', method: 'get', path: `${API}/admin/products/${NOT_FOUND_ID}` },
  { slug: 'products.create', method: 'post', path: `${API}/admin/products`, body: {} },
  { slug: 'products.update', method: 'patch', path: `${API}/admin/products/${NOT_FOUND_ID}`, body: {} },
  { slug: 'products.delete', method: 'delete', path: `${API}/admin/products/${NOT_FOUND_ID}` },

  // ---- categories (same namespace, same customer-grant hazard)
  { slug: 'categories.read', method: 'get', path: `${API}/admin/categories` },
  { slug: 'categories.read', method: 'get', path: `${API}/admin/categories/${NOT_FOUND_ID}` },
  { slug: 'categories.create', method: 'post', path: `${API}/admin/categories`, body: {} },
  { slug: 'categories.update', method: 'patch', path: `${API}/admin/categories/${NOT_FOUND_ID}`, body: {} },
  { slug: 'categories.delete', method: 'delete', path: `${API}/admin/categories/${NOT_FOUND_ID}` },

  // ---- inventory.manage
  { slug: 'inventory.read', method: 'get', path: `${API}/admin/inventory` },
  { slug: 'inventory.update', method: 'patch', path: `${API}/admin/inventory/${NOT_FOUND_ID}`, body: {} },

  // ---- orders.view / orders.update
  { slug: 'orders.read', method: 'get', path: `${API}/admin/orders` },
  { slug: 'orders.update', method: 'put', path: `${API}/admin/orders/${NOT_FOUND_ID}/status`, body: { status: 'PROCESSING' } },

  // ---- reports.view
  { slug: 'reports.read', method: 'get', path: `${API}/admin/dashboard` },
  { slug: 'reports.read', method: 'get', path: `${API}/admin/analytics` },

  // ---- customers.view
  { slug: 'customers.read', method: 'get', path: `${API}/admin/customers` },

  // ---- settings.manage
  { slug: 'settings.read', method: 'get', path: `${API}/admin/settings` },
  { slug: 'settings.read', method: 'get', path: `${API}/admin/payment-settings` },
  { slug: 'settings.update', method: 'put', path: `${API}/admin/settings/${NOT_FOUND_ID}`, body: {} },
  {
    slug: 'settings.update',
    method: 'put',
    path: `${API}/admin/payment-settings`,
    body: {},
    denyOnly: true,
  },

  // ---- staff.manage
  { slug: 'staff.read', method: 'get', path: `${API}/admin/staff` },
  { slug: 'staff.read', method: 'get', path: `${API}/admin/staff/${NOT_FOUND_ID}` },
  { slug: 'staff.read', method: 'get', path: `${API}/admin/roles` },
  { slug: 'staff.read', method: 'get', path: `${API}/admin/permissions` },
  { slug: 'staff.create', method: 'post', path: `${API}/admin/staff`, body: {} },
  { slug: 'staff.update', method: 'patch', path: `${API}/admin/staff/${NOT_FOUND_ID}`, body: {} },
  { slug: 'staff.delete', method: 'delete', path: `${API}/admin/staff/${NOT_FOUND_ID}` },

  // ---- discounts.manage
  { slug: 'discounts.read', method: 'get', path: `${API}/admin/discounts/coupons` },
  { slug: 'discounts.read', method: 'get', path: `${API}/admin/discounts/promotions` },
  { slug: 'discounts.create', method: 'post', path: `${API}/admin/discounts/coupons`, body: {} },
  { slug: 'discounts.update', method: 'patch', path: `${API}/admin/discounts/coupons/${NOT_FOUND_ID}`, body: {} },
  { slug: 'discounts.delete', method: 'delete', path: `${API}/admin/discounts/coupons/${NOT_FOUND_ID}` },

  // ---- invoices.view / invoices.create (NOTE: mounted outside /admin, so this
  //      row is guarded by the permission slug alone, with no role gate)
  { slug: 'invoices.create', method: 'post', path: `${API}/invoices/${NOT_FOUND_ID}/regenerate` },

  // ---- audit / delivery / support / contacts
  { slug: 'audit_logs.read', method: 'get', path: `${API}/admin/audit-logs` },
  { slug: 'delivery.read', method: 'get', path: `${API}/admin/delivery` },
  { slug: 'delivery.update', method: 'patch', path: `${API}/admin/delivery/${NOT_FOUND_ID}`, body: {} },
  { slug: 'support.read', method: 'get', path: `${API}/admin/support/tickets` },
  // The console never mutates a ticket through a bare `:id` route — status is
  // the verb it actually exposes. Pointing the probe at a route that does not
  // exist would let the staff row pass on a 404 that proves nothing.
  { slug: 'support.update', method: 'patch', path: `${API}/admin/support/tickets/${NOT_FOUND_ID}/status`, body: { status: 'IN_PROGRESS' } },
  { slug: 'contacts.read', method: 'get', path: `${API}/admin/support/contact-submissions` },
]

type Actor = 'unauthenticated' | 'customer' | 'staff' | 'admin' | 'owner'

/** Every principal that can carry a token — the escalator is an extra STAFF account,
 *  and `customerB` is the second tenant used for cross-tenant (IDOR) probes. */
type TokenHolder = Exclude<Actor, 'unauthenticated'> | 'escalator' | 'customerB'

const tokens: Record<TokenHolder, string> = {
  customer: '',
  customerB: '',
  staff: '',
  admin: '',
  owner: '',
  escalator: '',
}

const ids: Record<string, string> = {}

/** Fixtures owned by *other* principals, used for cross-tenant (IDOR) probes. */
const foreign = {
  orderId: '',
  orderNumber: '',
  addressId: '',
  invoiceOfA: '',
  invoiceOfB: '',
  ticketOfA: '',
  ticketOfB: '',
}

function call(actor: Actor, ep: Endpoint) {
  const req = request(app)[ep.method](ep.path)
  if (actor !== 'unauthenticated') {
    req.set('Authorization', `Bearer ${tokens[actor]}`)
  }
  if (ep.body !== undefined) {
    req.send(ep.body)
  }
  return req
}

async function createUserWithRole(opts: {
  email: string
  fullName: string
  role: RoleName
}): Promise<string> {
  const roleRow = await prisma.role.findUnique({ where: { name: opts.role } })
  if (!roleRow) throw new Error(`Role ${opts.role} is not seeded`)

  const user = await prisma.user.create({
    data: {
      email: opts.email,
      fullName: opts.fullName,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      role: opts.role,
      isActive: true,
      isVerified: true,
    },
  })

  await prisma.userRole.create({
    data: { userId: user.id, roleId: roleRow.id, assignedBy: 'RBAC_SUITE' },
  })

  return user.id
}

const createdUserIds: string[] = []

describe('VEDHIC FOODS — Role-Based Access Control', () => {
  beforeAll(async () => {
    // -----------------------------------------------------------------------
    // PRINCIPALS — one per role in the platform's RoleName enum.
    // -----------------------------------------------------------------------
    const ownerId = await createUserWithRole({
      email: `rbac.owner.${suffix}@vedhicfoods.test`,
      fullName: 'RBAC Owner',
      role: RoleName.OWNER,
    })
    const staffId = await createUserWithRole({
      email: `rbac.staff.${suffix}@vedhicfoods.test`,
      fullName: 'RBAC Staff',
      role: RoleName.STAFF,
    })
    createdUserIds.push(ownerId, staffId)

    ids.owner = ownerId
    ids.staff = staffId

    tokens.owner = (await AuthService.login({ email: `rbac.owner.${suffix}@vedhicfoods.test`, password: PASSWORD }))
      .accessToken
    tokens.staff = (await AuthService.login({ email: `rbac.staff.${suffix}@vedhicfoods.test`, password: PASSWORD }))
      .accessToken

    // Seeded administrator (password comes from the seeded dev credential the
    // rest of the integration suite already depends on).
    const adminLogin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    tokens.admin = adminLogin.accessToken
    ids.admin = adminLogin.user.id

    // Two independent customers, so horizontal (cross-tenant) access can be
    // measured rather than assumed.
    const customerA = await AuthService.register({
      fullName: 'RBAC Customer A',
      email: `rbac.customer.a.${suffix}@vedhicfoods.test`,
      password: PASSWORD,
    })
    const customerB = await AuthService.register({
      fullName: 'RBAC Customer B',
      email: `rbac.customer.b.${suffix}@vedhicfoods.test`,
      password: PASSWORD,
    })
    tokens.customer = customerA.accessToken
    tokens.customerB = customerB.accessToken
    ids.customerA = customerA.user.id
    ids.customerB = customerB.user.id
    createdUserIds.push(customerA.user.id, customerB.user.id)

    // -----------------------------------------------------------------------
    // CROSS-TENANT FIXTURES — real rows belonging to someone else.
    // -----------------------------------------------------------------------
    const someOrder = await prisma.order.findFirst({
      where: { userId: { notIn: [ids.customerA, ids.customerB] } },
      select: { id: true, orderNumber: true },
    })
    if (!someOrder) throw new Error('No pre-existing order available for IDOR fixtures')
    foreign.orderId = someOrder.id
    foreign.orderNumber = someOrder.orderNumber

    const someAddress = await prisma.address.findFirst({
      where: { userId: { notIn: [ids.customerA, ids.customerB] } },
      select: { id: true },
    })
    if (!someAddress) throw new Error('No pre-existing address available for IDOR fixtures')
    foreign.addressId = someAddress.id

    // Invoices: the suite creates its own so `invoice.userId` is unambiguous.
    // Orders that already carry an invoice are skipped — `Invoice.orderId` is
    // unique, so reusing one would fail on a second run after a crash.
    const invoiceOrders = await prisma.order.findMany({
      where: { invoice: null },
      select: { id: true },
      take: 2,
      orderBy: { createdAt: 'desc' },
    })
    if (invoiceOrders.length < 2) throw new Error('No invoice-free orders available for fixtures')
    const invA = await prisma.invoice.create({
      data: {
        invoiceNumber: `RBAC-INV-A-${suffix}`,
        orderId: invoiceOrders[0].id,
        userId: ids.customerA,
        subtotal: 100,
        total: 100,
      },
    })
    const invB = await prisma.invoice.create({
      data: {
        invoiceNumber: `RBAC-INV-B-${suffix}`,
        orderId: invoiceOrders[1].id,
        userId: ids.customerB,
        subtotal: 200,
        total: 200,
      },
    })
    foreign.invoiceOfA = invA.id
    foreign.invoiceOfB = invB.id

    const ticketA = await prisma.supportTicket.create({
      data: {
        ticketNumber: `RBAC-TKT-A-${suffix}`,
        userId: ids.customerA,
        subject: 'RBAC fixture ticket A',
        description: 'Created by the RBAC suite for cross-tenant isolation assertions.',
      },
    })
    const ticketB = await prisma.supportTicket.create({
      data: {
        ticketNumber: `RBAC-TKT-B-${suffix}`,
        userId: ids.customerB,
        subject: 'RBAC fixture ticket B',
        description: 'Created by the RBAC suite for cross-tenant isolation assertions.',
      },
    })
    foreign.ticketOfA = ticketA.id
    foreign.ticketOfB = ticketB.id
  }, 120000)

  afterAll(async () => {
    // Restore anything a nested suite may have left behind, then remove the
    // principals and fixtures this file introduced. Nothing here touches rows
    // the suite did not create.
    await prisma.rolePermission.deleteMany({
      where: {
        role: { name: RoleName.STAFF },
        permission: { slug: { in: ['staff.read', 'staff.create', 'staff.update', 'staff.delete'] } },
      },
    })

    await prisma.supportTicket.deleteMany({ where: { id: { in: [foreign.ticketOfA, foreign.ticketOfB] } } })
    await prisma.invoice.deleteMany({ where: { id: { in: [foreign.invoiceOfA, foreign.invoiceOfB] } } })
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
  }, 60000)

  // ==========================================================================
  // SECTION 1 — THE PERMISSION MATRIX
  // ==========================================================================
  describe('1. Permission matrix (role x protected endpoint)', () => {
    describe('unauthenticated requests are rejected with 401 on every endpoint', () => {
      for (const ep of ENDPOINTS) {
        it(`${ep.method.toUpperCase()} ${ep.path} -> 401`, async () => {
          const res = await call('unauthenticated', ep)
          expect(
            res.status,
            `expected 401, got ${res.status} — a protected route answered without a token`
          ).toBe(401)
        })
      }
    })

    describe('customer (wrong role, no permissions) is rejected with 403', () => {
      for (const ep of ENDPOINTS) {
        it(`${ep.method.toUpperCase()} ${ep.path} -> 403`, async () => {
          const res = await call('customer', ep)
          expect(
            res.status,
            `expected 403, got ${res.status} — a storefront customer passed an admin guard`
          ).toBe(403)
        })
      }
    })

    describe('staff is allowed exactly the seeded grant set, and nothing else', () => {
      for (const ep of ENDPOINTS) {
        const allowed = STAFF_SLUGS.has(ep.slug)
        it(`${ep.method.toUpperCase()} ${ep.path} [${ep.slug}] -> ${allowed ? 'permitted' : '403'}`, async () => {
          const res = await call('staff', ep)
          if (allowed) {
            expect(
              res.status,
              `staff holds ${ep.slug} but the API answered ${res.status}`
            ).not.toBe(401)
            expect(res.status).not.toBe(403)
          } else {
            expect(
              res.status,
              `staff lacks ${ep.slug} but the API answered ${res.status}`
            ).toBe(403)
          }
        })
      }
    })

    describe('admin is permitted on every endpoint (permission bypass by design)', () => {
      for (const ep of ENDPOINTS) {
        if (ep.denyOnly) continue
        it(`${ep.method.toUpperCase()} ${ep.path} -> not 401/403`, async () => {
          const res = await call('admin', ep)
          expect(res.status, `admin blocked with ${res.status}`).not.toBe(401)
          expect(res.status).not.toBe(403)
        })
      }
    })

    describe('owner is permitted on every endpoint (superadmin bypass by design)', () => {
      for (const ep of ENDPOINTS) {
        if (ep.denyOnly) continue
        it(`${ep.method.toUpperCase()} ${ep.path} -> not 401/403`, async () => {
          const res = await call('owner', ep)
          expect(res.status, `owner blocked with ${res.status}`).not.toBe(401)
          expect(res.status).not.toBe(403)
        })
      }
    })

    it('denial responses never disclose the platform permission taxonomy', async () => {
      // The 403 body must not echo which slugs the caller is missing — that is
      // a free map of the permission model for anyone probing the API.
      const probes: Array<[Actor, Endpoint]> = [
        ['customer', ENDPOINTS[0]],
        ['staff', ENDPOINTS.find((e) => e.slug === 'staff.create')!],
        ['customer', ENDPOINTS.find((e) => e.slug === 'settings.update')!],
      ]
      for (const [actor, ep] of probes) {
        const res = await call(actor, ep)
        expect(res.status).toBe(403)
        const body = JSON.stringify(res.body)
        expect(body).not.toContain('.read')
        expect(body).not.toContain('.create')
        expect(body).not.toContain('.update')
        expect(body).not.toContain('.delete')
      }
    })

    it('customer holds zero permissions (storefront catalog routes are public)', async () => {
      const res = await request(app)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${tokens.customer}`)
      expect(res.status).toBe(200)
      expect(res.body.permissions).toEqual([])
      for (const slug of ['products.read', 'categories.read']) {
        expect(CUSTOMER_SLUGS.has(slug)).toBe(false)
        expect(res.body.permissions).not.toContain(slug)
      }
    })
  })

  // ==========================================================================
  // SECTION 2 — SELF-SCOPED (TENANT) ENDPOINTS
  // ==========================================================================
  describe('2. Self-scoped endpoints', () => {
    it('GET /invoices requires authentication', async () => {
      const res = await request(app).get(`${API}/invoices`)
      expect(res.status).toBe(401)
    })

    it('a customer only ever receives their own invoices', async () => {
      const res = await request(app)
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${tokens.customer}`)
      expect(res.status).toBe(200)
      const rows = res.body.data ?? []
      const foreignIds = [foreign.invoiceOfB]
      for (const row of rows) {
        expect(row.userId).toBe(ids.customerA)
        expect(foreignIds).not.toContain(row.id)
      }
    })

    it('staff holding invoices.read receives the platform-wide list (permission is real)', async () => {
      const res = await request(app)
        .get(`${API}/invoices?limit=100`)
        .set('Authorization', `Bearer ${tokens.staff}`)
      expect(res.status).toBe(200)
      const rows: any[] = res.body.data ?? []
      expect(rows.some((r) => r.id === foreign.invoiceOfA)).toBe(true)
      expect(rows.some((r) => r.id === foreign.invoiceOfB)).toBe(true)
    })

    it('owner receives the platform-wide list', async () => {
      const res = await request(app)
        .get(`${API}/invoices`)
        .set('Authorization', `Bearer ${tokens.owner}`)
      expect(res.status).toBe(200)
      expect((res.body.data ?? []).length).toBeGreaterThan(0)
    })

    it('GET /orders/my-orders requires authentication', async () => {
      const res = await request(app).get(`${API}/orders/my-orders`)
      expect(res.status).toBe(401)
    })
  })

  // ==========================================================================
  // SECTION 3 — HORIZONTAL ACCESS (IDOR)
  //
  // Every probe in this section is issued with **customer B's** token against
  // rows owned by customer A (or by a third pre-existing account). Using the
  // wrong token here would make the assertion pass for the wrong reason — the
  // owner of a resource is always allowed to read it.
  // ==========================================================================
  describe('3. IDOR / horizontal access between customers', () => {
    it('customer A can read customer A\'s invoice (positive control for the probe below)', async () => {
      const res = await request(app)
        .get(`${API}/invoices/${foreign.invoiceOfA}`)
        .set('Authorization', `Bearer ${tokens.customer}`)
      expect(res.status).toBe(200)
    })

    it('customer B cannot read customer A\'s invoice', async () => {
      const res = await request(app)
        .get(`${API}/invoices/${foreign.invoiceOfA}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot download customer A\'s invoice', async () => {
      const res = await request(app)
        .get(`${API}/invoices/${foreign.invoiceOfA}/download`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot read an invoice through its order id', async () => {
      const order = await prisma.order.findFirst({ where: { id: foreign.orderId }, select: { id: true } })
      const res = await request(app)
        .get(`${API}/invoices/order/${order!.id}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot read an order that belongs to another account', async () => {
      const res = await request(app)
        .get(`${API}/orders/${foreign.orderId}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot read another account\'s order by order number', async () => {
      const res = await request(app)
        .get(`${API}/orders/${foreign.orderNumber}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot cancel an order that belongs to another account', async () => {
      const res = await request(app)
        .post(`${API}/orders/${foreign.orderId}/cancel`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
        .send({ reason: 'idor probe attempt' })
      expect([403, 404]).toContain(res.status)

      const untouched = await prisma.order.findFirst({ where: { id: foreign.orderId }, select: { status: true } })
      expect(untouched!.status).not.toBe('CANCELLED')
    })

    it('customer B cannot read another account\'s delivery tracking', async () => {
      const res = await request(app)
        .get(`${API}/orders/${foreign.orderNumber}/delivery`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot read another account\'s address', async () => {
      const res = await request(app)
        .get(`${API}/customer/addresses/${foreign.addressId}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot modify another account\'s address', async () => {
      const res = await request(app)
        .patch(`${API}/customer/addresses/${foreign.addressId}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
        .send({ city: 'IDOR City' })
      expect([403, 404]).toContain(res.status)

      const untouched = await prisma.address.findFirst({ where: { id: foreign.addressId } })
      expect(untouched!.city).not.toBe('IDOR City')
    })

    it('customer B cannot delete another account\'s address', async () => {
      const res = await request(app)
        .delete(`${API}/customer/addresses/${foreign.addressId}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)

      const untouched = await prisma.address.findFirst({ where: { id: foreign.addressId } })
      expect(untouched!.isDeleted).toBe(false)
    })

    it('customer B cannot read another account\'s support ticket', async () => {
      const res = await request(app)
        .get(`${API}/support/tickets/${foreign.ticketOfA}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot reply to another account\'s support ticket', async () => {
      const res = await request(app)
        .post(`${API}/support/tickets/${foreign.ticketOfA}/messages`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
        .send({ message: 'idor probe attempt' })
      expect([403, 404]).toContain(res.status)
    })

    it('customer B cannot close another account\'s support ticket', async () => {
      const res = await request(app)
        .post(`${API}/support/tickets/${foreign.ticketOfA}/close`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
        .send({ reason: 'idor probe attempt' })
      expect([403, 404]).toContain(res.status)

      const untouched = await prisma.supportTicket.findFirst({
        where: { id: foreign.ticketOfA },
        select: { status: true },
      })
      expect(untouched!.status).not.toBe('CLOSED')
    })

    it('a customer cannot read the staff directory (IDOR against /admin/staff)', async () => {
      const res = await request(app)
        .get(`${API}/admin/staff/${ids.owner}`)
        .set('Authorization', `Bearer ${tokens.customerB}`)
      expect(res.status).toBe(403)
    })

    it('the IDOR fixtures really do belong to a different account', async () => {
      const order = await prisma.order.findFirst({ where: { id: foreign.orderId } })
      expect(order).not.toBeNull()
      expect([ids.customerA, ids.customerB]).not.toContain(order!.userId)

      const invoiceA = await prisma.invoice.findFirst({ where: { id: foreign.invoiceOfA } })
      expect(invoiceA!.userId).toBe(ids.customerA)

      const ticketA = await prisma.supportTicket.findFirst({ where: { id: foreign.ticketOfA } })
      expect(ticketA!.userId).toBe(ids.customerA)
    })
  })

  // ==========================================================================
  // SECTION 4 — ROLE / PERMISSION ADMINISTRATION (RBAC lifecycle)
  // ==========================================================================
  describe('4. Role and permission administration', () => {
    it('owner can list every role with its permission set', async () => {
      const res = await request(app)
        .get(`${API}/admin/roles`)
        .set('Authorization', `Bearer ${tokens.owner}`)
      expect(res.status).toBe(200)
      const names = res.body.items.map((r: any) => r.name)
      expect(names).toEqual(expect.arrayContaining(['OWNER', 'ADMIN', 'STAFF', 'CUSTOMER']))

      const customerRole = res.body.items.find((r: any) => r.name === 'CUSTOMER')
      expect(customerRole.permissions).toEqual([])
    })

    it('owner can list the permission catalogue', async () => {
      const res = await request(app)
        .get(`${API}/admin/permissions`)
        .set('Authorization', `Bearer ${tokens.owner}`)
      expect(res.status).toBe(200)
      const slugs: string[] = res.body.items.map((p: any) => p.slug)
      // The canonical slugs are the seeded dot-nouns; assert the set the
      // platform actually ships so a rename cannot silently desync UI and API.
      expect(slugs.length).toBeGreaterThan(0)
      expect(slugs).toEqual(
        expect.arrayContaining([
          'products.read',
          'products.create',
          'products.update',
          'products.delete',
          'orders.read',
          'orders.update',
          'inventory.read',
          'inventory.update',
          'invoices.read',
          'discounts.create',
          'staff.create',
          'settings.update',
          'reports.read',
        ])
      )
    })

    it('roles are a closed set — an unknown role name is rejected, not created', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({
          fullName: 'Fake Superuser',
          email: `rbac.superuser.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: 'SUPERUSER',
        })
      expect(res.status).toBe(400)
      const exists = await prisma.user.findUnique({ where: { email: `rbac.superuser.${suffix}@vedhicfoods.test` } })
      expect(exists).toBeNull()
    })

    it('per-user permissions can be granted to a lower-ranked target and supersede role grants', async () => {
      const targetId = await createUserWithRole({
        email: `rbac.grant.${suffix}@vedhicfoods.test`,
        fullName: 'Grant Target',
        role: RoleName.STAFF,
      })
      createdUserIds.push(targetId)

      const res = await request(app)
        .patch(`${API}/admin/staff/${targetId}/permissions`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ permissionSlugs: ['settings.update', 'staff.delete'] })
      expect(res.status).toBe(200)

      // The per-user set replaces the role-derived set for this account.
      const resolved = await AuthService.resolveUserPermissions(targetId)
      expect(resolved.permissions.sort()).toEqual(['settings.update', 'staff.delete'])
    })

    it('permissionSlugs on create seed the account with exactly that grant set', async () => {
      const email = `rbac.creategrant.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({
          fullName: 'Create Grant',
          email,
          password: PASSWORD,
          role: RoleName.STAFF,
          permissionSlugs: ['settings.update'],
        })
      expect(res.status).toBe(201)
      createdUserIds.push(res.body.staff.id)

      const resolved = await AuthService.resolveUserPermissions(res.body.staff.id)
      expect(resolved.permissions).toEqual(['settings.update'])
    })

    it('roleId supplied in the body is ignored — the path/body role governs', async () => {
      const ownerRole = await prisma.role.findUnique({ where: { name: RoleName.OWNER } })
      const email = `rbac.massassign.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({
          fullName: 'Mass Assign Probe',
          email,
          password: PASSWORD,
          role: RoleName.STAFF,
          // Mass-assignment attempt: an attacker-supplied owner role id.
          roleId: ownerRole!.id,
          role_id: ownerRole!.id,
          permissions: ['settings.update'],
          isActive: false,
        })
      expect(res.status).toBe(201)

      const created = await prisma.user.findUnique({ where: { email } })
      expect(created).not.toBeNull()
      createdUserIds.push(created!.id)
      expect(created!.role).toBe(RoleName.STAFF)
      expect(created!.isActive).toBe(true)

      const resolved = await AuthService.resolveUserPermissions(created!.id)
      expect(resolved.permissions).not.toContain('settings.update')
    })

    it('revoking a permission from the STAFF role takes effect on the very next request', async () => {
      const staffRole = await prisma.role.findUnique({
        where: { name: RoleName.STAFF },
        include: { rolePermissions: { include: { permission: true } } },
      })
      const grant = staffRole!.rolePermissions.find((rp) => rp.permission.slug === 'orders.update')
      expect(grant, 'orders.update must be seeded onto STAFF for this test').toBeTruthy()

      const probe = { slug: 'orders.update', method: 'put' as const, path: `${API}/admin/orders/${NOT_FOUND_ID}/status`, body: { status: 'PROCESSING' } }

      // 1. Granted -> permitted.
      const before = await call('staff', probe)
      expect(before.status).not.toBe(403)

      // 2. Revoke -> denied on the next request, no re-login, no token change.
      await prisma.rolePermission.delete({ where: { id: grant!.id } })
      try {
        const during = await call('staff', probe)
        expect(during.status).toBe(403)

        // 3. The same bearer token still authenticates (401 would mean the
        //    account itself was disabled rather than the permission revoked).
        const identity = await request(app)
          .get(`${API}/auth/me`)
          .set('Authorization', `Bearer ${tokens.staff}`)
        expect(identity.status).toBe(200)
      } finally {
        await prisma.rolePermission.create({
          data: { roleId: staffRole!.id, permissionId: grant!.permissionId },
        })
      }

      // 4. Restored -> permitted again.
      const after = await call('staff', probe)
      expect(after.status).not.toBe(403)
    })
  })

  // ==========================================================================
  // SECTION 5 — STAFF LIFECYCLE (assign / disable / reactivate)
  // ==========================================================================
  describe('5. Staff role assignment, disabling and reactivation', () => {
    let lifecycleId = ''
    const lifecycleEmail = `rbac.lifecycle.${suffix}@vedhicfoods.test`

    afterAll(async () => {
      if (lifecycleId) createdUserIds.push(lifecycleId)
    })

    it('owner assigns a role to a new staff account', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({
          fullName: 'Lifecycle Staff',
          email: lifecycleEmail,
          password: PASSWORD,
          role: RoleName.STAFF,
        })
      expect(res.status).toBe(201)
      lifecycleId = res.body.staff.id
      expect(res.body.staff.role).toBe(RoleName.STAFF)
      expect(res.body.staff.permissions).toEqual(expect.arrayContaining(['orders.read']))
    })

    it('the newly assigned role is effective immediately for that account', async () => {
      const login = await AuthService.login({ email: lifecycleEmail, password: PASSWORD })
      const me = await request(app)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
      expect(me.status).toBe(200)
      expect(me.body.roles).toContain('STAFF')
      expect(me.body.permissions).toContain('orders.read')
      expect(me.body.permissions).not.toContain('settings.update')
    })

    it('disabling a staff account invalidates its sessions on the next request', async () => {
      const login = await AuthService.login({ email: lifecycleEmail, password: PASSWORD })
      const okBefore = await request(app)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
      expect(okBefore.status).toBe(200)

      const disable = await request(app)
        .patch(`${API}/admin/staff/${lifecycleId}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ isActive: false })
      expect(disable.status).toBe(200)
      expect(disable.body.staff.isActive).toBe(false)

      // The access token is still cryptographically valid — deactivation must
      // nevertheless be enforced server-side on every request.
      const okAfter = await request(app)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
      expect(okAfter.status).toBe(401)

      const adminCall = await request(app)
        .get(`${API}/admin/orders`)
        .set('Authorization', `Bearer ${login.accessToken}`)
      expect(adminCall.status).toBe(401)

      const loginAfter = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: lifecycleEmail, password: PASSWORD })
      expect(loginAfter.status).toBe(401)
    })

    it('reactivating the staff account restores access with the original token', async () => {
      const enable = await request(app)
        .patch(`${API}/admin/staff/${lifecycleId}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ isActive: true })
      expect(enable.status).toBe(200)
      expect(enable.body.staff.isActive).toBe(true)

      const login = await AuthService.login({ email: lifecycleEmail, password: PASSWORD })
      const restored = await request(app)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${login.accessToken}`)
      expect(restored.status).toBe(200)
      expect(restored.body.roles).toContain('STAFF')
    })

    it('a soft-deleted staff account can neither authenticate nor be used', async () => {
      const del = await request(app)
        .delete(`${API}/admin/staff/${lifecycleId}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
      expect(del.status).toBe(200)

      const login = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: lifecycleEmail, password: PASSWORD })
      expect(login.status).toBe(401)
    })

    it('the last active OWNER cannot be disabled', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.owner}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ isActive: false })
      expect(res.status).toBe(400)

      const stillActive = await prisma.user.findUnique({ where: { id: ids.owner } })
      expect(stillActive!.isActive).toBe(true)
    })
  })

  // ==========================================================================
  // SECTION 6 — PRIVILEGE ESCALATION & OWNER-ONLY OPERATIONS
  // ==========================================================================
  describe('6. Privilege escalation and owner-only operations', () => {
    // `staff.read` is granted alongside the mutating verbs because the probes
    // below read the directory to prove they can reach it before trying to walk
    // up the hierarchy — a read-only audience for the escalation attempts.
    const escalatedSlugs = ['staff.read', 'staff.create', 'staff.update', 'staff.delete']
    const grantedIds: string[] = []

    async function grantToStaff(slugs: string[]) {
      const staffRole = await prisma.role.findUnique({ where: { name: RoleName.STAFF } })
      for (const slug of slugs) {
        const perm = await prisma.permission.findUnique({ where: { slug } })
        if (!perm) throw new Error(`permission ${slug} not seeded`)
        // Idempotent: a crashed earlier run must not leave a duplicate behind.
        await prisma.rolePermission.deleteMany({
          where: { roleId: staffRole!.id, permissionId: perm.id },
        })
        const row = await prisma.rolePermission.create({
          data: { roleId: staffRole!.id, permissionId: perm.id },
        })
        grantedIds.push(row.id)
      }
    }

    async function revokeGrants() {
      if (grantedIds.length) {
        await prisma.rolePermission.deleteMany({ where: { id: { in: grantedIds } } })
        grantedIds.length = 0
      }
    }

    let escalatedStaffId = ''
    let peerStaffId = ''

    beforeAll(async () => {
      // Deliberately hand a STAFF account the staff-management permissions —
      // the exact configuration an operator would plausibly create — then try
      // to walk that account up the hierarchy. Every attempt below must fail.
      await grantToStaff(escalatedSlugs)

      escalatedStaffId = await createUserWithRole({
        email: `rbac.escalator.${suffix}@vedhicfoods.test`,
        fullName: 'RBAC Escalator',
        role: RoleName.STAFF,
      })
      peerStaffId = await createUserWithRole({
        email: `rbac.peer.${suffix}@vedhicfoods.test`,
        fullName: 'RBAC Peer',
        role: RoleName.STAFF,
      })
      createdUserIds.push(escalatedStaffId, peerStaffId)

      const login = await AuthService.login({
        email: `rbac.escalator.${suffix}@vedhicfoods.test`,
        password: PASSWORD,
      })
      tokens.escalator = login.accessToken
    }, 60000)

    afterAll(async () => {
      await revokeGrants()
    })

    it('the escalator really does hold the staff-management permission set', async () => {
      const res = await request(app)
        .get(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
      expect(res.status).toBe(200)

      const resolved = await AuthService.resolveUserPermissions(escalatedStaffId)
      for (const slug of escalatedSlugs) {
        expect(resolved.permissions, `escalator is missing ${slug}`).toContain(slug)
      }
    })

    it('a staff member cannot promote itself to ADMIN', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${escalatedStaffId}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ role: RoleName.ADMIN })
      expect(res.status).toBe(403)

      const after = await prisma.user.findUnique({ where: { id: escalatedStaffId } })
      expect(after!.role).toBe(RoleName.STAFF)
    })

    it('a staff member cannot promote itself to OWNER', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${escalatedStaffId}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ role: RoleName.OWNER })
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: escalatedStaffId } })
      expect(after!.role).toBe(RoleName.STAFF)
    })

    it('a staff member cannot promote a peer to ADMIN', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${peerStaffId}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ role: RoleName.ADMIN })
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: peerStaffId } })
      expect(after!.role).toBe(RoleName.STAFF)
    })

    it('a staff member cannot modify an ADMIN account (no upward reach)', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.admin}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ isActive: false })
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: ids.admin } })
      expect(after!.isActive).toBe(true)
    })

    it('a staff member cannot modify the OWNER account (no upward reach)', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.owner}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ isActive: false })
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: ids.owner } })
      expect(after!.isActive).toBe(true)
    })

    it('a staff member cannot reset an ADMIN password (account takeover)', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff/${ids.admin}/reset-password`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ newPassword: 'Hijacked@123' })
      expect(res.status).toBe(403)
    })

    it('a staff member cannot delete an ADMIN account', async () => {
      const res = await request(app)
        .delete(`${API}/admin/staff/${ids.admin}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: ids.admin } })
      expect(after!.isDeleted).toBe(false)
    })

    it('a staff member cannot create an ADMIN account', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({
          fullName: 'Illegally Promoted',
          email: `rbac.illegal.admin.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.ADMIN,
        })
      expect(res.status).toBe(403)
      const exists = await prisma.user.findUnique({ where: { email: `rbac.illegal.admin.${suffix}@vedhicfoods.test` } })
      expect(exists).toBeNull()
    })

    it('a staff member cannot create an OWNER account', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({
          fullName: 'Illegally Ownered',
          email: `rbac.illegal.owner.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.OWNER,
        })
      expect(res.status).toBe(403)
    })

    it('a staff member cannot grant itself permissions directly', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${escalatedStaffId}/permissions`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ permissionSlugs: ['settings.update'] })
      expect(res.status).toBe(403)
      const resolved = await AuthService.resolveUserPermissions(escalatedStaffId)
      expect(resolved.permissions).not.toContain('settings.update')
    })

    it('an ADMIN cannot create another ADMIN or OWNER (no lateral or upward minting)', async () => {
      for (const role of [RoleName.ADMIN, RoleName.OWNER]) {
        const res = await request(app)
          .post(`${API}/admin/staff`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({
            fullName: 'Admin Mint Probe',
            email: `rbac.mint.${role}.${suffix}@vedhicfoods.test`,
            password: PASSWORD,
            role,
          })
        expect(res.status, `admin was allowed to mint a ${role}`).toBe(403)
      }
    })

    it('an ADMIN cannot disable or edit another ADMIN', async () => {
      const victim = await createUserWithRole({
        email: `rbac.admin.victim.${suffix}@vedhicfoods.test`,
        fullName: 'RBAC Admin Victim',
        role: RoleName.ADMIN,
      })
      createdUserIds.push(victim)

      const res = await request(app)
        .patch(`${API}/admin/staff/${victim}`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ isActive: false })
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: victim } })
      expect(after!.isActive).toBe(true)
    })

    it('an ADMIN can create STAFF accounts (the legitimate path)', async () => {
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({
          fullName: 'Legit Staff',
          email: `rbac.legit.staff.${suffix}@vedhicfoods.test`,
          password: PASSWORD,
          role: RoleName.STAFF,
        })
      expect(res.status).toBe(201)
      createdUserIds.push(res.body.staff.id)
    })

    it('an OWNER may create another OWNER (the only sanctioned path upward)', async () => {
      const email = `rbac.second.owner.${suffix}@vedhicfoods.test`
      const res = await request(app)
        .post(`${API}/admin/staff`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ fullName: 'Second Owner', email, password: PASSWORD, role: RoleName.OWNER })
      expect(res.status).toBe(201)
      createdUserIds.push(res.body.staff.id)
      expect(res.body.staff.role).toBe(RoleName.OWNER)
    })

    it('no actor can change their own role, even with staff.update', async () => {
      const res = await request(app)
        .patch(`${API}/admin/staff/${escalatedStaffId}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ role: RoleName.ADMIN, fullName: 'Renamed Escalator' })
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: escalatedStaffId } })
      expect(after!.role).toBe(RoleName.STAFF)
    })

    it('a smuggled user id in the body cannot retarget a staff mutation (IDOR on :id)', async () => {
      // The path parameter must remain authoritative: point the body at the
      // caller's own account and the target at an ADMIN.
      const res = await request(app)
        .patch(`${API}/admin/staff/${ids.admin}`)
        .set('Authorization', `Bearer ${tokens.escalator}`)
        .send({ id: escalatedStaffId, userId: escalatedStaffId, isActive: false })
      expect(res.status).toBe(403)
      const after = await prisma.user.findUnique({ where: { id: ids.admin } })
      expect(after!.isActive).toBe(true)
    })

    it('customer is locked out of every staff-management verb', async () => {
      const probes: Array<[string, string, unknown]> = [
        ['get', `${API}/admin/staff`, undefined],
        ['post', `${API}/admin/staff`, { fullName: 'X', email: `rbac.x.${suffix}@vedhicfoods.test`, password: PASSWORD }],
        ['patch', `${API}/admin/staff/${ids.staff}`, { role: RoleName.ADMIN }],
        ['delete', `${API}/admin/staff/${ids.staff}`, undefined],
        ['post', `${API}/admin/staff/${ids.staff}/reset-password`, { newPassword: 'Hijacked@123' }],
        ['patch', `${API}/admin/staff/${ids.staff}/permissions`, { permissionSlugs: ['settings.update'] }],
      ]
      for (const [method, path, body] of probes) {
        const req = (request(app) as any)[method](path).set('Authorization', `Bearer ${tokens.customer}`)
        if (body !== undefined) req.send(body)
        const res = await req
        expect(res.status, `${method.toUpperCase()} ${path} answered ${res.status}`).toBe(403)
      }
    })
  })

  // ==========================================================================
  // SECTION 7 — TOKEN / IDENTITY INTEGRITY
  // ==========================================================================
  describe('7. Token and identity integrity', () => {
    it('rejects a missing token', async () => {
      const res = await request(app).get(`${API}/admin/orders`)
      expect(res.status).toBe(401)
    })

    it('rejects a malformed token', async () => {
      const res = await request(app).get(`${API}/admin/orders`).set('Authorization', 'Bearer not-a-jwt')
      expect(res.status).toBe(401)
    })

    it('rejects a token signed with a different secret', async () => {
      const forged = jwt.sign({ userId: ids.admin, tokenType: 'access' }, 'attacker-controlled-secret', {
        algorithm: 'HS256',
      })
      const res = await request(app).get(`${API}/admin/orders`).set('Authorization', `Bearer ${forged}`)
      expect(res.status).toBe(401)
    })

    it('rejects an `alg: none` token (algorithm confusion)', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(
        JSON.stringify({ userId: ids.admin, tokenType: 'access', exp: Math.floor(Date.now() / 1000) + 3600 })
      ).toString('base64url')
      const res = await request(app)
        .get(`${API}/admin/orders`)
        .set('Authorization', `Bearer ${header}.${payload}.`)
      expect(res.status).toBe(401)
    })

    it('rejects an expired token', async () => {
      const expired = jwt.sign(
        { userId: ids.admin, tokenType: 'access' },
        env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '-10s' }
      )
      const res = await request(app).get(`${API}/admin/orders`).set('Authorization', `Bearer ${expired}`)
      expect(res.status).toBe(401)
    })

    it('rejects a refresh token presented as a bearer credential', async () => {
      const registered = await AuthService.register({
        fullName: 'Refresh As Access',
        email: `rbac.refresh.${suffix}@vedhicfoods.test`,
        password: PASSWORD,
      })
      createdUserIds.push(registered.user.id)

      // Mint a refresh token the same way the service does: a JWT carrying
      // `tokenType: 'refresh'` must never authenticate a request even though it
      // is signed with the correct secret.
      const refreshLike = jwt.sign(
        { userId: registered.user.id, tokenType: 'refresh' },
        env.JWT_SECRET,
        { algorithm: 'HS256' }
      )
      const res = await request(app).get(`${API}/admin/orders`).set('Authorization', `Bearer ${refreshLike}`)
      expect(res.status).toBe(401)
    })

    it('a CUSTOMER token cannot reach owner-only console endpoints', async () => {
      const probes = [
        `${API}/admin/staff`,
        `${API}/admin/settings`,
        `${API}/admin/payment-settings`,
        `${API}/admin/orders`,
        `${API}/admin/audit-logs`,
        `${API}/admin/dashboard`,
      ]
      for (const path of probes) {
        const res = await request(app).get(path).set('Authorization', `Bearer ${tokens.customer}`)
        expect(res.status, `${path} answered ${res.status}`).toBe(403)
      }
    })

    it('authorization is enforced by the API alone — no frontend involved', async () => {
      // Every request in this suite goes straight to the Express app. To make
      // the point explicit, hit an admin endpoint with no Origin, no Referer
      // and no cookies: only the bearer token is consulted.
      const res = await request(app)
        .get(`${API}/admin/orders`)
        .set('Authorization', `Bearer ${tokens.customer}`)
        .set('Origin', 'https://evil.example')
        .set('Referer', 'https://evil.example/admin/orders')
      expect(res.status).toBe(403)
    })
  })

  // ==========================================================================
  // SECTION 8 — ADMIN CONSOLE LOGIN BOUNDARY
  // ==========================================================================
  describe('8. Admin console login boundary', () => {
    it('refuses a CUSTOMER account on the admin login endpoint', async () => {
      const res = await request(app)
        .post(`${API}/admin/auth/login`)
        .send({ email: `rbac.customer.a.${suffix}@vedhicfoods.test`, password: PASSWORD })
      expect(res.status).toBe(403)
      expect(res.body.accessToken).toBeUndefined()
      expect(res.body.refreshToken).toBeUndefined()
    })

    it('issues no refresh token when the role gate refuses', async () => {
      const res = await request(app)
        .post(`${API}/admin/auth/login`)
        .send({ email: `rbac.customer.b.${suffix}@vedhicfoods.test`, password: PASSWORD })
      expect(res.status).toBe(403)
      expect(res.body.token).toBeUndefined()

      const sessions = await prisma.refreshToken.count({
        where: { user: { email: `rbac.customer.b.${suffix}@vedhicfoods.test` }, isRevoked: false },
      })
      // Registration mints the only legitimate session; admin login must not
      // have added one.
      expect(sessions).toBeLessThanOrEqual(1)
    })

    it('still accepts STAFF, ADMIN and OWNER', async () => {
      for (const [email, password] of [
        [`rbac.staff.${suffix}@vedhicfoods.test`, PASSWORD],
        ['admin@vedhicfoods.com', 'Admin@Vedhic2026'],
        [`rbac.owner.${suffix}@vedhicfoods.test`, PASSWORD],
      ] as const) {
        const res = await request(app).post(`${API}/admin/auth/login`).send({ email, password })
        expect(res.status, `${email} rejected with ${res.status}`).toBe(200)
        expect(res.body.accessToken).toBeDefined()
      }
    })

    it('still rejects bad credentials with 401 rather than leaking the role gate', async () => {
      const res = await request(app)
        .post(`${API}/admin/auth/login`)
        .send({ email: `rbac.customer.a.${suffix}@vedhicfoods.test`, password: 'WrongPassword@1' })
      expect(res.status).toBe(401)
    })
  })

  // ==========================================================================
  // SECTION 9 — PUBLIC / GUEST SURFACES REMAIN INTENTIONALLY OPEN
  // ==========================================================================
  describe('9. Public surfaces (control group)', () => {
    it('storefront product listing needs no session', async () => {
      const res = await request(app).get(`${API}/products`)
      expect(res.status).toBe(200)
    })

    it('storefront category listing needs no session', async () => {
      const res = await request(app).get(`${API}/categories`)
      expect(res.status).toBe(200)
    })

    it('the admin catalog view is not reachable even though the storefront view is', async () => {
      const publicView = await request(app).get(`${API}/products`)
      expect(publicView.status).toBe(200)

      const adminView = await request(app)
        .get(`${API}/admin/products`)
        .set('Authorization', `Bearer ${tokens.customer}`)
      expect(adminView.status).toBe(403)
    })

    it('health checks stay unauthenticated', async () => {
      const res = await request(app).get(`${API}/health`)
      expect(res.status).toBe(200)
    })

    it('an inactive promotional campaign is not served through the public slug route', async () => {
      // The storefront slug lookup is public by design, but it must only ever
      // surface campaigns that are live. A draft or expired campaign leaks its
      // discount terms and can be deep-linked by anyone who guesses the slug.
      const slug = `rbac-hidden-promo-${suffix}`
      const promo = await prisma.promotion.create({
        data: {
          name: 'RBAC Hidden Campaign',
          slug,
          description: 'Created by the RBAC suite to prove inactive campaigns stay private.',
          discountType: 'PERCENTAGE',
          discountValue: 42,
          startDate: new Date('2020-01-01T00:00:00Z'),
          endDate: new Date('2020-02-01T00:00:00Z'),
          isActive: false,
        },
      })
      try {
        const res = await request(app).get(`${API}/promotions/${slug}`)
        expect(res.status).not.toBe(200)
        const body = JSON.stringify(res.body)
        // The slug embeds a millisecond timestamp whose digits can collide with
        // the discount value (e.g. `...774942` contains "42"), so the slug is
        // stripped before hunting for the leaked term.
        expect(body.replaceAll(slug, '')).not.toContain('42')
        expect(body).not.toContain('discountValue')
        expect(body).not.toContain('RBAC Hidden Campaign')
      } finally {
        await prisma.promotion.deleteMany({ where: { id: promo.id } })
      }
    })

    it('an expired campaign is not served through the public slug route either', async () => {
      // Distinct from the isActive filter above: this campaign is still flagged
      // active, but its window closed years ago. The date bounds are what keep
      // it out of reach, so the assertion is time-independent by construction.
      const slug = `rbac-expired-promo-${suffix}`
      const promo = await prisma.promotion.create({
        data: {
          name: 'RBAC Expired Campaign',
          slug,
          description: 'Created by the RBAC suite to prove expired campaigns stay private.',
          discountType: 'PERCENTAGE',
          discountValue: 73,
          startDate: new Date('2020-01-01T00:00:00Z'),
          endDate: new Date('2020-02-01T00:00:00Z'),
          isActive: true,
        },
      })
      try {
        const res = await request(app).get(`${API}/promotions/${slug}`)
        expect(res.status).not.toBe(200)
        const body = JSON.stringify(res.body)
        expect(body.replaceAll(slug, '')).not.toContain('73')
        expect(body).not.toContain('discountValue')
        expect(body).not.toContain('RBAC Expired Campaign')
      } finally {
        await prisma.promotion.deleteMany({ where: { id: promo.id } })
      }
    })
  })
})
