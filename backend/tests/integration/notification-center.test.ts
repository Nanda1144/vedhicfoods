import './_safety'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { NotificationType, RoleName, DeliveryStatus } from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { OrderEmailService } from '../../src/services/order-email.service'
import { DiscountService } from '../../src/services/discount.service'
import { NotificationCenterService } from '../../src/services/notification-center.service'
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'

const app = createApp()

const stamp = Date.now()
const TAG = String(stamp)
const uniq = (n: number) => `${stamp}${n}`

const ADMIN_EMAIL = 'admin@vedhicfoods.com'
const ADMIN_PASSWORD = 'Admin@Vedhic2026'

const staffEmail = `notif.staff.${TAG}@vedhicfoods.com`
const customerAEmail = `notif.cust.a.${TAG}@vedhicfoods.com`
const customerBEmail = `notif.cust.b.${TAG}@vedhicfoods.com`

/**
 * Helpers shared across the suite.
 */
async function destroyContact(contactId: string): Promise<void> {
  await prisma.supportNotification.deleteMany({ where: { contactId } })
  await prisma.auditLog.deleteMany({ where: { entityId: contactId } })
  await prisma.contactSubmission.deleteMany({ where: { id: contactId } })
}

async function destroyTicket(ticketId: string): Promise<void> {
  await prisma.supportNotification.deleteMany({ where: { ticketId } })
  await prisma.auditLog.deleteMany({ where: { entityId: ticketId } })
  await prisma.supportTicket.deleteMany({ where: { id: ticketId } })
}

async function makeOrderFor(userId: string, userEmail: string): Promise<{
  order: { id: string; orderNumber: string }
  delivery: { id: string }
  cleanup: () => Promise<void>
}> {
  const suffix = Math.floor(Math.random() * 1e9)
  const category = await prisma.category.create({
    data: { name: `Notif Cat ${suffix}`, slug: `notif-cat-${suffix}` },
  })
  const product = await prisma.product.create({
    data: {
      name: `Notif Product ${suffix}`,
      slug: `notif-prod-${suffix}`,
      sku: `SKU-NOTIF-${TAG}-${suffix}`,
      categoryId: category.id,
      price: 100,
      mrp: 120,
      stock: 10,
    },
  })
  const order = await prisma.order.create({
    data: {
      orderNumber: `VF-NOTIF-${TAG}-${suffix}`,
      userId,
      customerName: 'Notification Customer',
      customerEmail: userEmail,
      phone: `98${(suffix % 100000000).toString().padStart(8, '0')}`,
      subtotal: 100,
      total: 100,
      items: {
        create: [{ productId: product.id, name: product.name, quantity: 1, price: 100, subtotal: 100 }],
      },
    },
  })
  const delivery = await prisma.delivery.create({
    data: { orderId: order.id, status: DeliveryStatus.PENDING },
  })

  return {
    order: { id: order.id, orderNumber: order.orderNumber },
    delivery: { id: delivery.id },
    cleanup: async () => {
      await prisma.deliveryHistory.deleteMany({ where: { deliveryId: delivery.id } })
      await prisma.delivery.deleteMany({ where: { id: delivery.id } })
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } })
      await prisma.order.deleteMany({ where: { id: order.id } })
      await prisma.product.deleteMany({ where: { id: product.id } })
      await prisma.category.deleteMany({ where: { id: category.id } })
    },
  }
}

async function countNotifications(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId } })
}

describe('In-App Notification Centre', () => {
  let adminToken: string
  let adminId: string
  let staffToken: string
  let staffId: string
  let customerAToken: string
  let customerAId: string
  let customerBToken: string
  let customerBId: string
  // Retained only to neutralise the transport (see beforeAll); the sends it
  // intercepts are the parallel email channel, not the inbox under test.
  let _emailSpy: ReturnType<typeof vi.spyOn>

  const createdStaffIds: string[] = []

  async function loginAs(email: string, password: string): Promise<{ token: string; id: string }> {
    const res = await AuthService.login({ email, password })
    return { token: res.accessToken, id: res.user.id }
  }

  beforeAll(async () => {
    // Neutralise the real email transport: under NODE_ENV=test an unmocked send
    // would reach the live provider. The order/support lifecycle emails are not
    // under test here — the in-app notification mirror is — but they must not
    // fire real traffic while being emitted.
    _emailSpy = vi
      .spyOn(BrevoEmailService, 'sendTransactionalEmail')
      .mockResolvedValue('notif-test-message-id')

    const adminLogin = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = adminLogin.token
    adminId = adminLogin.id

    // --- Staff recipient (contact broadcasts, support assignment) ------------
    const staffRole = await prisma.role.findFirstOrThrow({ where: { name: RoleName.STAFF } })
    const staff = await prisma.user.create({
      data: {
        email: staffEmail,
        fullName: 'Inbox Staff Member',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        role: RoleName.STAFF,
        phone: `+9190${(stamp % 100000000).toString().padStart(8, '0')}`,
        isActive: true,
        isVerified: true,
      },
    })
    staffId = staff.id
    await prisma.userRole.create({
      data: { userId: staffId, roleId: staffRole.id, assignedBy: 'SYSTEM_TEST' },
    })
    staffToken = (await loginAs(staffEmail, 'Staff@Vedhic2026!')).token

    // --- Two customer recipients ------------------------------------------------
    const customerRole = await prisma.role.findFirstOrThrow({ where: { name: RoleName.CUSTOMER } })
    const customerA = await prisma.user.create({
      data: {
        email: customerAEmail,
        fullName: 'Inbox Customer A',
        passwordHash: await AuthService.hashPassword('Customer@Vedhic2026!'),
        role: RoleName.CUSTOMER,
        phone: `+9198${((stamp + 1) % 100000000).toString().padStart(8, '0')}`,
        isActive: true,
        isVerified: true,
      },
    })
    customerAId = customerA.id
    await prisma.userRole.create({
      data: { userId: customerAId, roleId: customerRole.id, assignedBy: 'SYSTEM_TEST' },
    })
    customerAToken = (await loginAs(customerAEmail, 'Customer@Vedhic2026!')).token

    const customerB = await prisma.user.create({
      data: {
        email: customerBEmail,
        fullName: 'Inbox Customer B',
        passwordHash: await AuthService.hashPassword('Customer@Vedhic2026!'),
        role: RoleName.CUSTOMER,
        phone: `+9197${((stamp + 2) % 100000000).toString().padStart(8, '0')}`,
        isActive: true,
        isVerified: true,
      },
    })
    customerBId = customerB.id
    await prisma.userRole.create({
      data: { userId: customerBId, roleId: customerRole.id, assignedBy: 'SYSTEM_TEST' },
    })
    customerBToken = (await loginAs(customerBEmail, 'Customer@Vedhic2026!')).token
  })

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: [adminId, staffId, customerAId, customerBId, ...createdStaffIds] } },
    })

    // The additional staff accounts minted by the lifecycle test have no
    // dependent rows, so they can be removed cleanly. The long-lived fixture
    // users are intentionally left in place (they may still own order rows).
    await prisma.userRole.deleteMany({ where: { userId: { in: createdStaffIds } } })
    await prisma.user.deleteMany({ where: { id: { in: createdStaffIds } } })
  })

  describe('API lifecycle', () => {
    it('rejects unauthenticated access', async () => {
      const res = await request(app).get('/api/v1/notifications')
      expect(res.status).toBe(401)
    })

    it('lists, filters, reads, toggles and deletes a user\u2019s own notifications', async () => {
      const seeded = await prisma.notification.createMany({
        data: [
          {
            userId: customerAId,
            type: NotificationType.PAYMENT_UPDATE,
            title: 'Payment confirmed',
            message: 'Order VF-1 paid.',
            eventKey: `seed_a:${TAG}`,
          },
          {
            userId: customerAId,
            type: NotificationType.DELIVERY_UPDATE,
            title: 'Order delivered',
            message: 'Order VF-1 delivered.',
            eventKey: `seed_b:${TAG}`,
          },
        ],
      })
      expect(seeded.count).toBe(2)

      const list = await request(app)
        .get('/api/v1/notifications?per_page=10')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(list.status).toBe(200)
      expect(list.body.data.unreadCount).toBe(2)
      expect(list.body.data.pagination.total).toBe(2)
      expect(list.body.data.items).toHaveLength(2)
      const targets = list.body.data.items as Array<{ id: string; isRead: boolean; type: string }>
      expect(targets.map((i) => i.type).sort()).toEqual(
        [NotificationType.PAYMENT_UPDATE, NotificationType.DELIVERY_UPDATE].sort()
      )

      const unreadOnly = await request(app)
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(unreadOnly.status).toBe(200)
      expect(unreadOnly.body.data.items).toHaveLength(2)

      const typeFilter = await request(app)
        .get(`/api/v1/notifications?type=${NotificationType.PAYMENT_UPDATE}`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(typeFilter.status).toBe(200)
      expect(typeFilter.body.data.items).toHaveLength(1)
      expect(typeFilter.body.data.items[0].type).toBe(NotificationType.PAYMENT_UPDATE)

      const target = targets[0]

      const read = await request(app)
        .post(`/api/v1/notifications/${target.id}/read`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(read.status).toBe(200)
      expect(read.body.data.isRead).toBe(true)

      // Idempotent: re-reading an already-read item is still a 200, not an error.
      const readAgain = await request(app)
        .post(`/api/v1/notifications/${target.id}/read`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(readAgain.status).toBe(200)

      const afterRead = await request(app)
        .get('/api/v1/notifications?per_page=10')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(afterRead.body.data.unreadCount).toBe(1)

      const unread = await request(app)
        .post(`/api/v1/notifications/${target.id}/unread`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(unread.status).toBe(200)
      expect(unread.body.data.isRead).toBe(false)

      const get = await request(app)
        .get(`/api/v1/notifications/${target.id}`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(get.status).toBe(200)
      expect(get.body.data.notification.id).toBe(target.id)
      expect(get.body.data.notification.isRead).toBe(false)

      const allRead = await request(app)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(allRead.status).toBe(200)
      expect(allRead.body.data.updated).toBe(2)

      const allReadAgain = await request(app)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(allReadAgain.status).toBe(200)
      expect(allReadAgain.body.data.updated).toBe(0)

      const unreadCount = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(unreadCount.status).toBe(200)
      expect(unreadCount.body.data.unreadCount).toBe(0)

      const del = await request(app)
        .delete(`/api/v1/notifications/${target.id}`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(del.status).toBe(200)
      expect(del.body.data.deleted).toBe(true)

      const gone = await request(app)
        .get(`/api/v1/notifications/${target.id}`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(gone.status).toBe(404)

      const missing = await request(app)
        .post('/api/v1/notifications/does-not-exist/read')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(missing.status).toBe(404)

      // Pagination ceiling is enforced (per_page clamped to 100, not echoed).
      const clamped = await request(app)
        .get('/api/v1/notifications?per_page=99999')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(clamped.status).toBe(200)
      expect(clamped.body.data.pagination.perPage).toBe(100)

      await prisma.notification.deleteMany({
        where: { id: { in: [target.id, targets[1].id] } },
      })
    })

    it('never lets one user observe or mutate another user\u2019s notification', async () => {
      const victimNotification = await prisma.notification.create({
        data: {
          userId: customerAId,
          type: NotificationType.SYSTEM_ALERT,
          title: 'Private to A',
          message: 'customer A secret',
          eventKey: `isolation:${TAG}`,
        },
      })

      for (const token of [customerBToken, staffToken, adminToken]) {
        const read = await request(app)
          .get(`/api/v1/notifications/${victimNotification.id}`)
          .set('Authorization', `Bearer ${token}`)
        expect(read.status).toBe(404)
        expect(read.body.data).toBeUndefined()

        const mark = await request(app)
          .post(`/api/v1/notifications/${victimNotification.id}/read`)
          .set('Authorization', `Bearer ${token}`)
        expect(mark.status).toBe(404)

        const unmark = await request(app)
          .post(`/api/v1/notifications/${victimNotification.id}/unread`)
          .set('Authorization', `Bearer ${token}`)
        expect(unmark.status).toBe(404)

        const del = await request(app)
          .delete(`/api/v1/notifications/${victimNotification.id}`)
          .set('Authorization', `Bearer ${token}`)
        expect(del.status).toBe(404)
      }

      // An admin "read-all" must not sweep the customer's inbox.
      const adminCameThrough = await request(app)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(adminCameThrough.status).toBe(200)

      const stillUnread = await prisma.notification.findUnique({
        where: { id: victimNotification.id },
        select: { isRead: true },
      })
      expect(stillUnread?.isRead).toBe(false)

      await prisma.notification.deleteMany({ where: { id: victimNotification.id } })
    })
  })

  describe('Order & payment events', () => {
    it('payment confirmation emits a PAYMENT_UPDATE and webhook replay cannot duplicate it', async () => {
      const live = await makeOrderFor(customerAId, customerAEmail)
      const before = await countNotifications(customerAId)

      await OrderEmailService.paymentConfirmed(live.order.id)
      await OrderEmailService.paymentConfirmed(live.order.id) // "replayed" webhook

      const rows = await prisma.notification.findMany({
        where: { userId: customerAId, eventKey: `payment_confirmed:${live.order.id}` },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].type).toBe(NotificationType.PAYMENT_UPDATE)
      expect(rows[0].isRead).toBe(false)
      expect((rows[0].metadata as any).orderId).toBe(live.order.id)
      expect((rows[0].metadata as any).orderNumber).toBe(live.order.orderNumber)

      const after = await countNotifications(customerAId)
      expect(after).toBe(before + 1)

      await live.cleanup()
    })

    it('concurrent emits of the same logical event resolve to exactly one row', async () => {
      const live = await makeOrderFor(customerAId, customerAEmail)
      const key = `payment_confirmed:${live.order.id}`
      const promises = Array.from({ length: 5 }, () =>
        NotificationCenterService.emit({
          userId: customerAId,
          type: NotificationType.PAYMENT_UPDATE,
          title: 'Payment confirmed',
          message: 'concurrent',
          eventKey: key,
        })
      )
      await Promise.all(promises)

      const rows = await prisma.notification.count({ where: { userId: customerAId, eventKey: key } })
      expect(rows).toBe(1)

      await live.cleanup()
    })

    it('payment failure, cancellation and refund each produce their own event', async () => {
      const live = await makeOrderFor(customerAId, customerAEmail)

      await OrderEmailService.paymentFailed(live.order.id, 'Insufficient funds')
      const failure = await prisma.notification.findMany({
        where: { userId: customerAId, eventKey: `payment_failed:${live.order.id}` },
      })
      expect(failure).toHaveLength(1)
      expect(failure[0].type).toBe(NotificationType.PAYMENT_UPDATE)
      expect(failure[0].title).toContain('failed')

      await OrderEmailService.orderCancelled(live.order.id, 'Changed my mind')
      const cancelled = await prisma.notification.findMany({
        where: { userId: customerAId, eventKey: `order_cancelled:${live.order.id}` },
      })
      expect(cancelled).toHaveLength(1)
      expect(cancelled[0].type).toBe(NotificationType.ORDER_UPDATE)
      expect(cancelled[0].title).toContain('cancelled')

      await OrderEmailService.refundProcessed(live.order.id, {
        refundId: `ref-${TAG}`,
        amount: 100,
        status: 'successful',
      })
      const refund = await prisma.notification.findMany({
        where: { userId: customerAId, eventKey: `refund:${live.order.id}:ref-${TAG}` },
      })
      expect(refund).toHaveLength(1)
      expect(refund[0].type).toBe(NotificationType.PAYMENT_UPDATE)
      expect((refund[0].metadata as any).refundId).toBe(`ref-${TAG}`)

      await live.cleanup()
    })

    it('admin paid-order alert broadcasts a SYSTEM_ALERT to admins and owners only', async () => {
      const live = await makeOrderFor(customerAId, customerAEmail)
      const adminBefore = await countNotifications(adminId)
      const customerBefore = await countNotifications(customerAId)

      await OrderEmailService.notifyAdminPaidOrder(live.order.id)

      const adminRow = await prisma.notification.findFirst({
        where: { userId: adminId, eventKey: `admin_paid_order:${live.order.id}` },
      })
      expect(adminRow).not.toBeNull()
      expect(adminRow!.type).toBe(NotificationType.SYSTEM_ALERT)
      expect(adminRow!.title).toContain('fulfilment')

      // The paying customer is not an operations recipient.
      expect(await countNotifications(customerAId)).toBe(customerBefore)
      expect(await countNotifications(adminId)).toBe(adminBefore + 1)

      await live.cleanup()
    })
  })

  describe('Delivery lifecycle (via the admin HTTP endpoint)', () => {
    it('mirrors every delivery phase into the customer inbox with the matching dedupe key', async () => {
      const live = await makeOrderFor(customerAId, customerAEmail)
      const before = await countNotifications(customerAId)

      // PENDING -> ASSIGNED: no customer lifecycle event expected yet.
      const assigned = await request(app)
        .patch(`/api/v1/admin/delivery/${live.delivery.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ASSIGNED' })
      expect(assigned.status).toBe(200)
      expect(await countNotifications(customerAId)).toBe(before)

      const shipped = await request(app)
        .patch(`/api/v1/admin/delivery/${live.delivery.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SHIPPED' })
      expect(shipped.status).toBe(200)
      const shippedRow = await prisma.notification.findFirst({
        where: { userId: customerAId, eventKey: `delivery_shipped:${live.order.id}` },
      })
      expect(shippedRow).not.toBeNull()
      expect(shippedRow!.type).toBe(NotificationType.ORDER_UPDATE)
      expect(shippedRow!.title).toContain('shipped')

      const outForDelivery = await request(app)
        .patch(`/api/v1/admin/delivery/${live.delivery.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'OUT_FOR_DELIVERY' })
      expect(outForDelivery.status).toBe(200)
      const outRow = await prisma.notification.findFirst({
        where: { userId: customerAId, eventKey: `delivery_out_for_delivery:${live.order.id}` },
      })
      expect(outRow).not.toBeNull()
      expect(outRow!.type).toBe(NotificationType.DELIVERY_UPDATE)
      expect((outRow!.metadata as any).orderId).toBe(live.order.id)

      const delivered = await request(app)
        .patch(`/api/v1/admin/delivery/${live.delivery.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'DELIVERED' })
      expect(delivered.status).toBe(200)
      const deliveredRow = await prisma.notification.findFirst({
        where: { userId: customerAId, eventKey: `delivery_delivered:${live.order.id}` },
      })
      expect(deliveredRow).not.toBeNull()
      expect(deliveredRow!.type).toBe(NotificationType.DELIVERY_UPDATE)

      // A retried admin action (duplicate status push) adds no inbox rows.
      const resend = await request(app)
        .patch(`/api/v1/admin/delivery/${live.delivery.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'DELIVERED' })
      expect(resend.status).toBe(400)
      expect(
        await prisma.notification.count({
          where: { userId: customerAId, eventKey: `delivery_delivered:${live.order.id}` },
        })
      ).toBe(1)

      expect(await countNotifications(customerAId)).toBe(before + 3)

      await live.cleanup()
    })
  })

  describe('Promotion events', () => {
    it('publishing a promotion notifies every active customer once', async () => {
      const cat = await prisma.category.create({
        data: { name: `Promo Cat ${uniq(5)}`, slug: `promo-cat-${uniq(5)}` },
      })
      const promo = await prisma.promotion.create({
        data: {
          name: `Fresh Bites ${TAG}`,
          slug: `fresh-bites-${TAG}`,
          description: 'Test promotion',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startDate: new Date(Date.now() - 60_000),
          endDate: new Date(Date.now() + 86_400_000),
          isActive: false,
        },
      })
      await prisma.promotionCategory.create({
        data: { promotionId: promo.id, categoryId: cat.id },
      })

      await DiscountService.togglePromotionStatus(promo.id, true, {
        id: adminId,
        email: ADMIN_EMAIL,
      })
      // A wasted disable + re-enable must not double-notify the same promotion.
      await DiscountService.togglePromotionStatus(promo.id, false, {
        id: adminId,
        email: ADMIN_EMAIL,
      })
      await DiscountService.togglePromotionStatus(promo.id, true, {
        id: adminId,
        email: ADMIN_EMAIL,
      })

      for (const customerId of [customerAId, customerBId]) {
        const rows = await prisma.notification.findMany({
          where: { userId: customerId, eventKey: `promotion_published:${promo.id}` },
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].type).toBe(NotificationType.PROMOTION)
      }

      // Staff are not customers and must not be mailed the customer broadcast.
      expect(
        await prisma.notification.count({
          where: { userId: staffId, eventKey: `promotion_published:${promo.id}` },
        })
      ).toBe(0)

      await prisma.promotionCategory.deleteMany({ where: { promotionId: promo.id } })
      await prisma.promotion.deleteMany({ where: { id: promo.id } })
      await prisma.category.deleteMany({ where: { id: cat.id } })
    })
  })

  describe('Contact form', () => {
    it('accepted submissions notify the STAFF role in-app; spam never does', async () => {
      const staffBefore = await countNotifications(staffId)

      const accepted = await request(app).post('/api/v1/contact').send({
        name: 'Inbox Visitor',
        email: `visitor.${TAG}@example.com`,
        subject: 'Ragi flour question',
        category: 'PRODUCT_QUESTION',
        message: 'Is the finger millet flour stone-ground?',
      })
      expect(accepted.status).toBe(201)
      const reference = accepted.body.data.reference as string
      const row = await prisma.contactSubmission.findUnique({ where: { reference } })
      expect(row).not.toBeNull()

      const staffAlert = await prisma.notification.findFirst({
        where: { userId: staffId, eventKey: `contact_submission:${row!.id}` },
      })
      expect(staffAlert).not.toBeNull()
      expect(staffAlert!.type).toBe(NotificationType.SYSTEM_ALERT)
      expect(staffAlert!.title).toContain('New contact message')
      expect((staffAlert!.metadata as any).contactId).toBe(row!.id)
      expect(await countNotifications(staffId)).toBe(staffBefore + 1)

      // The customer A inbox is untouched by a public form submission.
      expect(
        await prisma.notification.count({
          where: { userId: customerAId, eventKey: `contact_submission:${row!.id}` },
        })
      ).toBe(0)

      // Honeypot-trapped spam is quarantined and never notifies staff.
      const spam = await request(app).post('/api/v1/contact').send({
        name: 'Bot Brain',
        email: `spambot.${TAG}@example.com`,
        subject: 'Buy now alert',
        category: 'GENERAL',
        message: 'Click this link to win gold',
        website: 'http://spam.example.com',
      })
      // Quarantined submissions return 200 with accepted:false (see
      // support-contact.test.ts): the attacker is denied confirmation.
      expect(spam.status).toBe(200)
      const spamRow = await prisma.contactSubmission.findFirst({
        where: { email: `spambot.${TAG}@example.com` },
        orderBy: { submittedAt: 'desc' },
      })
      expect(spamRow?.isSpam).toBe(true)
      expect(
        await prisma.notification.count({
          where: { userId: staffId, eventKey: `contact_submission:${spamRow!.id}` },
        })
      ).toBe(0)

      await destroyContact(row!.id)
      await destroyContact(spamRow!.id)
    })
  })

  describe('Support replies', () => {
    it('a staff reply alerts the customer and a customer reply alerts the assigned staff', async () => {
      const create = await request(app)
        .post('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ subject: 'Inbox support ticket', description: 'Please help with my order.' })
      expect(create.status).toBe(201)
      const ticketId = create.body.data.ticket?.id ?? create.body.data.id

      const assign = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedStaffId: staffId })
      expect(assign.status).toBe(200)

      const customerBefore = await countNotifications(customerAId)
      const staffBefore = await countNotifications(staffId)

      const staffReply = await request(app)
        .post(`/api/v1/admin/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ message: 'We are looking into this and will update you shortly.' })
      expect(staffReply.status).toBe(200)
      const staffMsgId = staffReply.body.data.message?.id
      expect(staffMsgId).toBeTruthy()

      const customerAlert = await prisma.notification.findFirst({
        where: { userId: customerAId, eventKey: `support_staff_reply:${staffMsgId}` },
      })
      expect(customerAlert).not.toBeNull()
      expect(customerAlert!.type).toBe(NotificationType.SUPPORT_UPDATE)
      expect(customerAlert!.title).toContain('Staff reply')
      expect(await countNotifications(customerAId)).toBe(customerBefore + 1)

      const customerReply = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: 'Thank you, that helps.' })
      expect(customerReply.status).toBe(200)
      const customerMsgId = customerReply.body.data.message?.id
      expect(customerMsgId).toBeTruthy()

      const staffAlert = await prisma.notification.findFirst({
        where: { userId: staffId, eventKey: `support_customer_reply:${customerMsgId}` },
      })
      expect(staffAlert).not.toBeNull()
      expect(staffAlert!.type).toBe(NotificationType.SUPPORT_UPDATE)
      expect(await countNotifications(staffId)).toBe(staffBefore + 1)

      // Replying customer is not notified of their own message.
      expect(
        await prisma.notification.count({
          where: { userId: customerAId, eventKey: `support_customer_reply:${customerMsgId}` },
        })
      ).toBe(0)

      await destroyTicket(ticketId)
    })
  })

  describe('Staff lifecycle', () => {
    it('create / disable / reactivate / delete / password-reset each alert the admin console', async () => {
      const adminBefore = await countNotifications(adminId)
      const customerInbox = await countNotifications(customerAId)

      // --- create -------------------------------------------------------------
      const create = await request(app)
        .post('/api/v1/admin/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Inbox Admin Assistant',
          email: `inbox.staff.${TAG}@vedhicfoods.com`,
          password: 'Assistant@Vedhic2026',
          role: RoleName.STAFF,
        })
      expect(create.status).toBe(201)
      const newStaffId = create.body.staff.id as string
      createdStaffIds.push(newStaffId)

      const createdAlert = await prisma.notification.findFirst({
        where: { userId: adminId, eventKey: `staff_created:${newStaffId}` },
      })
      expect(createdAlert).not.toBeNull()
      expect(createdAlert!.type).toBe(NotificationType.SYSTEM_ALERT)

      // --- disable ------------------------------------------------------------
      const disable = await request(app)
        .patch(`/api/v1/admin/staff/${newStaffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
      expect(disable.status).toBe(200)
      const disabledAlert = await prisma.notification.findFirst({
        where: { userId: adminId, eventKey: `staff_disabled:${newStaffId}` },
      })
      expect(disabledAlert).not.toBeNull()
      expect(disabledAlert!.title).toContain('disabled')

      // --- reactivate ---------------------------------------------------------
      const reactivate = await request(app)
        .patch(`/api/v1/admin/staff/${newStaffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true })
      expect(reactivate.status).toBe(200)
      const reactivatedAlert = await prisma.notification.findFirst({
        where: { userId: adminId, eventKey: `staff_reactivated:${newStaffId}` },
      })
      expect(reactivatedAlert).not.toBeNull()
      expect(reactivatedAlert!.title).toContain('reactivated')

      // --- password reset ----------------------------------------------------
      const reset = await request(app)
        .post(`/api/v1/admin/staff/${newStaffId}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'Rotated@Vedhic2026' })
      expect(reset.status).toBe(200)
      const resetAlert = await prisma.notification.findMany({
        where: { userId: adminId, eventKey: { contains: `staff_password_reset:${newStaffId}:` } },
      })
      expect(resetAlert.length).toBe(1)
      expect(resetAlert[0].title).toContain('reset')

      // --- delete -------------------------------------------------------------
      const remove = await request(app)
        .delete(`/api/v1/admin/staff/${newStaffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(remove.status).toBe(200)
      const deletedAlert = await prisma.notification.findFirst({
        where: { userId: adminId, eventKey: `staff_deleted:${newStaffId}` },
      })
      expect(deletedAlert).not.toBeNull()
      expect(deletedAlert!.title).toContain('deleted')

      // Staff console alerts must not leak into customer inboxes.
      expect(await countNotifications(customerAId)).toBe(customerInbox)
      expect(await countNotifications(adminId)).toBe(adminBefore + 5)
    })
  })
})