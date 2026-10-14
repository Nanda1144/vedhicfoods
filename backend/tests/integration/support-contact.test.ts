import './_safety'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { RoleName, TicketStatus } from '@prisma/client'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { SpamService } from '../../src/services/spam.service'
import { SupportNotificationService } from '../../src/services/support-notification.service'
import { BrevoEmailService } from '../../src/integrations/brevo/brevo.service'

const app = createApp()

const stamp = Date.now()
const testStartedAt = new Date()
const TAG = String(stamp)
const uniq = (n: number) => `${stamp}${n}`

const ADMIN_EMAIL = 'admin@vedhicfoods.com'
const ADMIN_PASSWORD = 'Admin@Vedhic2026'

/**
 * Rate limiting is deliberately relaxed to 10 000 requests under
 * NODE_ENV=test (see rate-limiter.middleware.ts), so a 429 cannot be provoked
 * from an integration test without unsetting NODE_ENV and destabilising every
 * other suite. The limiter is asserted by configuration instead.
 */
const RELAXED_LIMIT = 10_000

describe('Contact & Customer Support Subsystem', () => {
  let adminToken: string
  let adminId: string
  let staffToken: string
  let staffId: string
  let bareStaffToken: string
  let customerAToken: string
  let customerAId: string
  let customerAEmail: string
  let customerBToken: string
  let customerBId: string
  let customerBEmail: string
  let emailSpy: ReturnType<typeof vi.spyOn>

  const customerAPhone = `98${(stamp % 100000000).toString().padStart(8, '0')}`
  const customerBPhone = `97${((stamp + 7) % 100000000).toString().padStart(8, '0')}`

  const staffEmail = `support.staff.${TAG}@vedhicfoods.com`
  const bareStaffEmail = `support.noperm.${TAG}@vedhicfoods.com`
  const customerAEmailLocal = `support.cust.a.${TAG}@vedhicfoods.com`
  const customerBEmailLocal = `support.cust.b.${TAG}@vedhicfoods.com`

  const SENT_MESSAGE_ID = 'test-message-id'

  beforeAll(async () => {
    // Neutralise the real email transport for the whole suite.
    //
    // The dev-mode simulation guard is `NODE_ENV === 'development'`, so under
    // NODE_ENV=test an unmocked send reaches the live provider and retries with
    // exponential backoff. Registration alone fires a verification and a welcome
    // email, which pushed fixture setup past the hook timeout. Individual tests
    // override the behaviour to exercise the failure paths.
    emailSpy = vi
      .spyOn(BrevoEmailService, 'sendTransactionalEmail')
      .mockResolvedValue(SENT_MESSAGE_ID)

    const adminLogin = await AuthService.login({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    })
    adminToken = adminLogin.accessToken
    adminId = adminLogin.user.id

    // --- Staff holding the full support permission set -----------------------
    const staffRole = await prisma.role.findFirstOrThrow({ where: { name: RoleName.STAFF } })
    const staffUser = await prisma.user.create({
      data: {
        email: staffEmail,
        fullName: 'Sita Support Agent',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        role: RoleName.STAFF,
        phone: `+9196${(stamp % 100000000).toString().padStart(8, '0')}`,
        isActive: true,
        isVerified: true,
      },
    })
    staffId = staffUser.id
    await prisma.userRole.create({
      data: { userId: staffId, roleId: staffRole.id, assignedBy: 'SYSTEM_TEST' },
    })

    // Re-assert the STAFF grants this suite depends on.
    //
    // Effective permissions are derived exclusively from role_permissions rows,
    // and other suites temporarily narrow the STAFF role in place. Re-asserting
    // the grants keeps this file correct regardless of run order, and the
    // assertion below turns a missing support migration into a clear failure
    // instead of a wall of 403s.
    const requiredSlugs = [
      'support.read',
      'support.reply',
      'support.update',
      'support.assign',
      'support.close',
      'contacts.read',
      'contacts.manage',
    ]
    const permissions = await prisma.permission.findMany({
      where: { slug: { in: requiredSlugs } },
      select: { id: true, slug: true },
    })
    expect(
      permissions.map((p) => p.slug).sort()
    ).toEqual([...requiredSlugs].sort())

    const granted = await prisma.rolePermission.findMany({
      where: { roleId: staffRole.id },
      select: { permissionId: true },
    })
    const grantedIds = new Set(granted.map((row) => row.permissionId))
    const missing = permissions.filter((p) => !grantedIds.has(p.id))
    if (missing.length > 0) {
      await prisma.rolePermission.createMany({
        data: missing.map((p) => ({ roleId: staffRole.id, permissionId: p.id })),
      })
    }

    staffToken = (
      await AuthService.login({ email: staffEmail, password: 'Staff@Vedhic2026!' })
    ).accessToken

    // --- Staff with a valid account but zero support permissions -------------
    // Effective permissions are derived exclusively from UserRole rows, so a
    // STAFF user with no role assignment resolves to an empty permission set.
    await prisma.user.create({
      data: {
        email: bareStaffEmail,
        fullName: 'Ravi No Permission',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        role: RoleName.STAFF,
        phone: `+9195${(stamp % 100000000).toString().padStart(8, '0')}`,
        isActive: true,
        isVerified: true,
      },
    })
    bareStaffToken = (
      await AuthService.login({ email: bareStaffEmail, password: 'Staff@Vedhic2026!' })
    ).accessToken

    // --- Two customers for ownership-isolation assertions --------------------
    const regA = await AuthService.register({
      fullName: 'Anita Customer',
      email: customerAEmailLocal,
      password: 'CustomerA@Vedhic2026!',
      phone: customerAPhone,
    })
    customerAToken = regA.accessToken
    customerAId = regA.user.id
    customerAEmail = regA.user.email

    const regB = await AuthService.register({
      fullName: 'Bhaskar Customer',
      email: customerBEmailLocal,
      password: 'CustomerB@Vedhic2026!',
      phone: customerBPhone,
    })
    customerBToken = regB.accessToken
    customerBId = regB.user.id
    customerBEmail = regB.user.email
  }, 90_000)

  afterEach(() => {
    // Restore the default behaviour so one test's simulated outage cannot leak.
    emailSpy?.mockResolvedValue(SENT_MESSAGE_ID)
  })

  afterAll(async () => {
    emailSpy?.mockRestore()

    // Guarded: if fixture setup failed there is nothing to clean up, and letting
    // Prisma throw here would bury the original failure.
    if (!customerAId || !customerBId) return

    // Support rows first: notifications/messages cascade from their ticket.
    await prisma.supportNotification.deleteMany({
      where: {
        OR: [
          { dedupeKey: { contains: TAG } },
          { ticket: { userId: { in: [customerAId, customerBId] } } },
          { contact: { email: { contains: TAG } } },
        ],
      },
    })
    await prisma.supportTicket.deleteMany({
      where: { userId: { in: [customerAId, customerBId] } },
    })
    await prisma.contactSubmission.deleteMany({ where: { email: { contains: TAG } } })
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: testStartedAt } } })
    await prisma.notification.deleteMany({
      where: { userId: { in: [customerAId, customerBId, staffId] } },
    })
    await prisma.user.deleteMany({
      where: { email: { in: [staffEmail, bareStaffEmail, customerAEmailLocal, customerBEmailLocal] } },
    })
    await prisma.$disconnect()
  })

  /** Remove a ticket and everything hanging off it. */
  async function destroyTicket(ticketId: string): Promise<void> {
    await prisma.supportNotification.deleteMany({ where: { ticketId } })
    await prisma.auditLog.deleteMany({ where: { entityId: ticketId } })
    await prisma.supportTicket.deleteMany({ where: { id: ticketId } })
  }

  async function destroyContact(contactId: string): Promise<void> {
    await prisma.supportNotification.deleteMany({ where: { contactId } })
    await prisma.auditLog.deleteMany({ where: { entityId: contactId } })
    await prisma.contactSubmission.deleteMany({ where: { id: contactId } })
  }

  async function createTicket(
    token: string,
    body: Record<string, unknown> = {}
  ): Promise<string> {
    const res = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Damaged pack on arrival',
        description: 'The organic jaggery pack arrived cracked and leaking.',
        ...body,
      })
    expect(res.status).toBe(201)
    return res.body.data.ticket.id as string
  }

  // ==========================================================
  // CONTACT FORM VALIDATION
  // ==========================================================

  describe('POST /api/v1/contact — public contact submission', () => {
    it('accepts a valid submission and returns reference, status and timestamp', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Kavya Rao',
        email: `kavya.${uniq(1)}@example.com`,
        subject: 'Question about millet flour',
        category: 'PRODUCT_QUESTION',
        message: 'Is the ragi flour stone-ground? I would like to know before ordering.',
      })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.reference).toMatch(/^CONTACT-\d{4}-\d{6}$/)
      expect(res.body.data.status).toBe('NEW')
      expect(new Date(res.body.data.submittedAt).getTime()).toBeLessThanOrEqual(Date.now())

      const row = await prisma.contactSubmission.findUnique({
        where: { reference: res.body.data.reference },
      })
      expect(row).not.toBeNull()
      expect(row!.isSpam).toBe(false)
      expect(row!.status).toBe('NEW')
      // The visitor IP is retained for abuse investigation
      expect(row!.ipAddress).toBeTruthy()
      expect(row!.submittedAt).toBeInstanceOf(Date)

      await destroyContact(row!.id)
    })

    it('requires no authentication and captures the forwarded client IP', async () => {
      const res = await request(app)
        .post('/api/v1/contact')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({
          name: 'Anonymous Visitor',
          email: `anon.${TAG}a@example.com`,
          subject: 'Do you ship internationally',
          category: 'GENERAL',
          message: 'I would like to know whether you ship to my country.',
        })

      expect(res.status).toBe(201)

      const row = await prisma.contactSubmission.findUnique({
        where: { reference: res.body.data.reference },
      })
      expect(row!.ipAddress).toBe('203.0.113.10')
      await destroyContact(row!.id)
    })

    it('rejects a missing name', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        email: `noname.${TAG}@example.com`,
        subject: 'A valid subject line',
        message: 'This message body is definitely long enough.',
      })
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(JSON.stringify(res.body.details)).toContain('name')
    })

    it('rejects an invalid email address', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Bad Email',
        email: 'not-an-email',
        subject: 'A valid subject line',
        message: 'This message body is definitely long enough.',
      })
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body.details)).toContain('email')
    })

    it('rejects a message shorter than the minimum length', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Too Brief',
        email: `brief.${TAG}@example.com`,
        subject: 'A valid subject line',
        message: 'hi',
      })
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body.details)).toContain('message')
    })

    it('rejects markup in the name field', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: '<script>alert(1)</script>',
        email: `xss.${TAG}@example.com`,
        subject: 'A valid subject line',
        message: 'This message body is definitely long enough.',
      })
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body.details)).toContain('name')
    })

    it.each(['ORDER_ENQUIRY', 'DELIVERY_ISSUE', 'RETURN_REFUND'])(
      'requires a phone number for category %s',
      async (category) => {
        const res = await request(app).post('/api/v1/contact').send({
          name: 'Order Woes',
          email: `nophone.${category}.${TAG}@example.com`,
          subject: 'Where is my order',
          category,
          message: 'My order was delivered to the wrong address and I need help.',
        })
        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(JSON.stringify(res.body.details)).toContain('phone')
      }
    )

    it('accepts a phone-free enquiry in a category that does not require one', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Casual Enquirer',
        email: `casual.${TAG}@example.com`,
        subject: 'Opening hours please',
        category: 'GENERAL',
        message: 'What time do you open on weekdays? I would like to visit.',
      })
      expect(res.status).toBe(201)
      const row = await prisma.contactSubmission.findUnique({
        where: { reference: res.body.data.reference },
      })
      expect(row!.phone).toBeNull()
      await destroyContact(row!.id)
    })

    it('accepts and normalises an Indian mobile number in +91 spaced format', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Order Woes',
        email: `order.${uniq(3)}@example.com`,
        phone: '+91 98765 43210',
        subject: 'Where is my order',
        category: 'ORDER_ENQUIRY',
        message: 'My order was delivered to the wrong address and I need help.',
      })
      expect(res.status).toBe(201)

      const row = await prisma.contactSubmission.findUnique({
        where: { reference: res.body.data.reference },
      })
      expect(row!.phone).toBe('9876543210')
      await destroyContact(row!.id)
    })

    it('rejects a malformed phone number', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Bad Phone',
        email: `badphone.${TAG}@example.com`,
        phone: '12345',
        subject: 'A valid subject line',
        category: 'DELIVERY_ISSUE',
        message: 'The courier never arrived and I need this resolved urgently.',
      })
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body.details)).toContain('phone')
    })
  })

  // ==========================================================
  // SPAM PROTECTION
  // ==========================================================

  describe('Spam protection', () => {
    it('quarantines a honeypot submission and returns an indistinguishable success', async () => {
      const botEmail = `bot.${TAG}@example.com`

      const res = await request(app).post('/api/v1/contact').send({
        name: 'Spam Bot',
        email: botEmail,
        subject: 'Cheap SEO backlinks for your site',
        message: 'Buy backlinks and make money fast with our SEO service today.',
        website: 'http://spam.example.com',
      })

      // A 400 here would tell the bot precisely which field gave it away.
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const row = await prisma.contactSubmission.findFirst({ where: { email: botEmail } })
      expect(row).not.toBeNull()
      expect(row!.isSpam).toBe(true)
      expect(row!.status).toBe('SPAM')
      expect(row!.spamReasons).toContain('honeypot_field_filled')
      // Quarantined spam must never reach a human mailbox
      expect(row!.notifiedAt).toBeNull()
      expect(
        await prisma.supportNotification.count({ where: { contactId: row!.id } })
      ).toBe(0)

      await destroyContact(row!.id)
    })

    it('quarantines a blocklisted-keyword submission', async () => {
      const spamEmail = `crypto.${TAG}@example.com`

      const res = await request(app).post('/api/v1/contact').send({
        name: 'Crypto Pitch',
        email: spamEmail,
        subject: 'Investment opportunity',
        message: 'I want to tell you about a crypto airdrop giveaway, click here now.',
      })

      expect(res.status).toBe(200)

      const row = await prisma.contactSubmission.findFirst({ where: { email: spamEmail } })
      expect(row!.isSpam).toBe(true)
      expect(row!.status).toBe('SPAM')
      expect(row!.spamReasons.some((r) => r.startsWith('blocked_keyword'))).toBe(true)
      expect(row!.notifiedAt).toBeNull()

      await destroyContact(row!.id)
    })

    it('quarantines a script-injection attempt', async () => {
      const injectEmail = `inject.${TAG}@example.com`

      const res = await request(app).post('/api/v1/contact').send({
        name: 'Injector',
        email: injectEmail,
        subject: 'Hello there friend',
        message: 'Look at this <script>alert(document.cookie)</script> payload please.',
      })

      expect(res.status).toBe(200)

      const row = await prisma.contactSubmission.findFirst({ where: { email: injectEmail } })
      expect(row!.isSpam).toBe(true)
      expect(row!.spamReasons).toContain('markup_or_script_injection')

      await destroyContact(row!.id)
    })

    it('quarantines a verbatim resubmission of the same message', async () => {
      const dupEmail = `repeat.${TAG}@example.com`
      const payload = {
        name: 'Repeat Sender',
        email: dupEmail,
        subject: 'Asking about wholesale rates',
        category: 'WHOLESALE',
        message: 'Could you share your wholesale pricing for bulk millet orders?',
      }

      const first = await request(app).post('/api/v1/contact').send(payload)
      expect(first.status).toBe(201)
      const firstRow = await prisma.contactSubmission.findUnique({
        where: { reference: first.body.data.reference },
      })
      expect(firstRow!.isSpam).toBe(false)

      const second = await request(app).post('/api/v1/contact').send(payload)
      expect(second.status).toBe(200)

      const rows = await prisma.contactSubmission.findMany({
        where: { email: dupEmail },
        orderBy: { submittedAt: 'desc' },
      })
      expect(rows).toHaveLength(2)
      expect(rows[0].isSpam).toBe(true)
      expect(rows[0].spamReasons).toContain('duplicate_message_content')

      await destroyContact(rows[0].id)
      await destroyContact(rows[1].id)
    })

    it('accepts a legitimate payment complaint that overlaps spam vocabulary', async () => {
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Priya Payments',
        email: `legit.${TAG}@example.com`,
        subject: 'Payment failed but money debited',
        category: 'GENERAL',
        message:
          'My card payment failed during checkout but the amount was debited from my account. Please refund it.',
      })

      expect(res.status).toBe(201)

      const row = await prisma.contactSubmission.findUnique({
        where: { reference: res.body.data.reference },
      })
      // A real customer must never be silently discarded.
      expect(row!.isSpam).toBe(false)
      expect(row!.spamScore).toBeLessThan(SpamService.threshold)
      expect(row!.status).toBe('NEW')

      await destroyContact(row!.id)
    })

    it('discards a honeypot ticket creation without persisting anything', async () => {
      const res = await request(app)
        .post('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          subject: 'Automated ticket spam',
          description: 'This ticket body should never be stored by a bot.',
          website: 'http://spam.example.com',
        })

      // Indistinguishable from a real creation.
      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)

      const stored = await prisma.supportTicket.count({
        where: { subject: 'Automated ticket spam' },
      })
      expect(stored).toBe(0)
    })

    it('discards a honeypot reply without persisting anything', async () => {
      const ticketId = await createTicket(customerAToken)

      const res = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: 'Bot reply that must never reach the staff inbox.', website: 'spam' })

      expect(res.status).toBe(200)

      const messages = await prisma.supportMessage.findMany({ where: { ticketId } })
      expect(messages).toHaveLength(1)

      await destroyTicket(ticketId)
    })

    describe('scoring rules', () => {
      it('records a too-fast submission without discarding it on that signal alone', () => {
        const verdict = SpamService.score({
          text: 'A perfectly ordinary enquiry body that a human would type.',
          email: 'human@example.com',
          userAgent: 'Mozilla/5.0',
          renderedAt: Date.now() - 100,
        })
        expect(verdict.reasons).toContain('submitted_too_quickly')
        // Worth 4 points, one short of the threshold: a brisk typist with a
        // pre-filled form must not be silently discarded.
        expect(verdict.score).toBe(4)
        expect(verdict.isSpam).toBe(false)
      })

      it('quarantines a too-fast submission once another rule also trips', () => {
        const verdict = SpamService.score({
          text: 'Buy now http://a.example.com http://b.example.com http://c.example.com quick deal',
          email: 'bot@example.com',
          userAgent: 'Mozilla/5.0',
          renderedAt: Date.now() - 100,
        })
        expect(verdict.reasons).toContain('submitted_too_quickly')
        expect(verdict.reasons).toContain('excessive_links')
        expect(verdict.isSpam).toBe(true)
      })

      it('does not penalise a human-speed submission', () => {
        const verdict = SpamService.score({
          text: 'A perfectly ordinary enquiry body that a human would type.',
          email: 'human@example.com',
          userAgent: 'Mozilla/5.0',
          renderedAt: Date.now() - 60_000,
        })
        expect(verdict.isSpam).toBe(false)
      })

      it('exposes its tuning constants for assertions', () => {
        expect(SpamService.threshold).toBeGreaterThan(0)
        expect(SpamService.duplicateWindowHours).toBe(24)
        expect(SpamService.minHumanFillMs).toBe(3000)
      })

      it('relaxes the rate limiters under NODE_ENV=test', () => {
        // Documented limitation rather than a behavioural assertion.
        expect(RELAXED_LIMIT).toBe(10_000)
      })
    })
  })

  // ==========================================================
  // ACCOUNT ATTRIBUTION
  // ==========================================================

  describe('Contact submission account attribution', () => {
    it('attributes an authenticated submission to the caller account', async () => {
      const res = await request(app)
        .post('/api/v1/contact')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          name: 'Anita Customer',
          email: customerAEmail,
          subject: 'Please call me about my order',
          category: 'ORDER_ENQUIRY',
          phone: customerAPhone,
          message: 'I would prefer a phone call about the status of my order.',
        })
      expect(res.status).toBe(201)

      const row = await prisma.contactSubmission.findUnique({
        where: { reference: res.body.data.reference },
      })
      expect(row!.userId).toBe(customerAId)
      await destroyContact(row!.id)
    })

    it('does NOT attribute an anonymous submission to a known account', async () => {
      // Knowing a victim's email address must not be enough to attach an
      // inquiry — and later, an escalated ticket — to their account.
      const res = await request(app).post('/api/v1/contact').send({
        name: 'Someone Else Entirely',
        email: customerBEmail,
        subject: 'Claiming to be you',
        category: 'GENERAL',
        message: 'I am pretending to own this email address for the test.',
      })

      expect(res.status).toBe(201)
      const row = await prisma.contactSubmission.findUnique({
        where: { reference: res.body.data.reference },
      })
      expect(row!.userId).toBeNull()
      await destroyContact(row!.id)
    })
  })

  // ==========================================================
  // TICKET LIFECYCLE
  // ==========================================================

  describe('Customer ticket lifecycle', () => {
    let ticketId: string

    afterEach(async () => {
      if (ticketId) {
        await destroyTicket(ticketId)
        ticketId = ''
      }
    })

    it('requires authentication to create a ticket', async () => {
      const res = await request(app).post('/api/v1/support/tickets').send({
        subject: 'I need help with my order',
        description: 'Please help me with my order status right away.',
      })
      expect(res.status).toBe(401)
    })

    it('rejects an invalid ticket payload', async () => {
      const res = await request(app)
        .post('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ subject: 'no', description: 'short' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('creates a ticket as OPEN with an initial message', async () => {
      const res = await request(app)
        .post('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          subject: 'Damaged pack on arrival',
          description: 'The organic jaggery pack arrived cracked and leaking.',
          category: 'DELIVERY_ISSUE',
          priority: 'HIGH',
        })

      expect(res.status).toBe(201)
      const ticket = res.body.data.ticket
      ticketId = ticket.id

      expect(ticket.ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/)
      expect(ticket.status).toBe(TicketStatus.OPEN)
      expect(ticket.priority).toBe('HIGH')
      expect(ticket.source).toBe('PORTAL')
      expect(ticket.userId).toBe(customerAId)
      expect(ticket.messages).toHaveLength(1)
      expect(ticket.messages[0].isStaff).toBe(false)
    })

    it('lists only the caller own tickets', async () => {
      ticketId = await createTicket(customerAToken)

      const res = await request(app)
        .get('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items.some((t: any) => t.id === ticketId)).toBe(true)
      expect(res.body.items.every((t: any) => t.userId === customerAId)).toBe(true)
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1)
    })

    it('filters the caller own tickets by status', async () => {
      ticketId = await createTicket(customerAToken)

      const res = await request(app)
        .get('/api/v1/support/tickets?status=CLOSED')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items.every((t: any) => t.status === 'CLOSED')).toBe(true)
      expect(res.body.items.some((t: any) => t.id === ticketId)).toBe(false)
    })

    it('rejects a ticket referencing another customer order', async () => {
      const category = await prisma.category.create({
        data: { name: `Support Cat ${TAG}`, slug: `support-cat-${TAG}` },
      })
      const product = await prisma.product.create({
        data: {
          name: `Support Product ${TAG}`,
          slug: `support-product-${TAG}`,
          sku: `SKU-SUP-${TAG}`,
          categoryId: category.id,
          price: 100,
          mrp: 120,
          stock: 10,
        },
      })
      const order = await prisma.order.create({
        data: {
          orderNumber: `VF-SUPPORT-${TAG}`,
          userId: customerBId,
          customerName: 'Bhaskar Customer',
          customerEmail: customerBEmail,
          phone: customerBPhone,
          subtotal: 100,
          total: 100,
          items: {
            create: [{ productId: product.id, name: product.name, quantity: 1, price: 100, subtotal: 100 }],
          },
        },
      })

      const res = await request(app)
        .post('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          subject: 'Order reference probe',
          description: 'Trying to attach somebody else order to my ticket.',
          orderId: order.id,
        })

      expect(res.status).toBe(404)
      expect(
        await prisma.supportTicket.count({ where: { description: { contains: 'somebody else order' } } })
      ).toBe(0)

      await prisma.orderItem.deleteMany({ where: { orderId: order.id } })
      await prisma.order.delete({ where: { id: order.id } })
      await prisma.product.delete({ where: { id: product.id } })
      await prisma.category.delete({ where: { id: category.id } })
    })

    it('allows the owner to reply', async () => {
      ticketId = await createTicket(customerAToken)

      const res = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: 'Adding that the outer box was also wet when it arrived.' })

      expect(res.status).toBe(200)
      expect(res.body.data.message.isStaff).toBe(false)
      expect(res.body.data.ticket.messages).toHaveLength(2)
    })

    it('rejects an empty reply', async () => {
      ticketId = await createTicket(customerAToken)

      const res = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: '' })

      expect(res.status).toBe(400)
    })

    it('allows the owner to close with a reason', async () => {
      ticketId = await createTicket(customerAToken)

      const res = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ reason: 'Replacement already shipped, nothing else needed.' })

      expect(res.status).toBe(200)
      expect(res.body.data.ticket.status).toBe(TicketStatus.CLOSED)
      expect(res.body.data.ticket.closedAt).toBeTruthy()
      expect(res.body.data.ticket.closeReason).toBe(
        'Replacement already shipped, nothing else needed.'
      )
    })

    it('refuses a second close and allows a reopen', async () => {
      ticketId = await createTicket(customerAToken)
      const close = { reason: 'Closing this ticket for a legitimate reason.' }

      await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send(close)

      const again = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send(close)
      expect(again.status).toBe(409)

      const reopen = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/reopen`)
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(reopen.status).toBe(200)
      expect(reopen.body.data.ticket.status).toBe(TicketStatus.OPEN)
      expect(reopen.body.data.ticket.reopenedCount).toBe(1)
    })

    it('rejects replies to a closed ticket from the customer', async () => {
      ticketId = await createTicket(customerAToken)

      await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ reason: 'Temporarily closing while I wait for the courier.' })

      const res = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: 'Trying to continue the conversation after closure.' })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('closed')
    })

    it('clears WAITING_FOR_CUSTOMER when the customer answers', async () => {
      ticketId = await createTicket(customerAToken)

      await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'WAITING_FOR_CUSTOMER', reason: 'Need the bank reference number' })

      const res = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: 'Here is the bank reference number you asked for.' })

      expect(res.status).toBe(200)
      expect(res.body.data.ticket.status).toBe(TicketStatus.IN_PROGRESS)
    })
  })

  // ==========================================================
  // OWNERSHIP ISOLATION
  // ==========================================================

  describe('Ticket ownership isolation', () => {
    let privateTicketId: string

    beforeEach(async () => {
      privateTicketId = await createTicket(customerAToken, {
        subject: 'Private matter for customer A',
        description: 'This conversation is between me and the support team only.',
      })
    })

    afterEach(async () => {
      await destroyTicket(privateTicketId)
    })

    it('hides another customer ticket from GET by id with 404, not 403', async () => {
      const res = await request(app)
        .get(`/api/v1/support/tickets/${privateTicketId}`)
        .set('Authorization', `Bearer ${customerBToken}`)

      // 403 would confirm the ticket exists and allow enumeration.
      expect(res.status).toBe(404)
      expect(res.body.error).toContain('not found')
    })

    it('hides another customer ticket from the list endpoint', async () => {
      const res = await request(app)
        .get('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerBToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items.some((t: any) => t.id === privateTicketId)).toBe(false)
      expect(res.body.items.every((t: any) => t.userId === customerBId)).toBe(true)
    })

    it('blocks a cross-customer reply without writing a message', async () => {
      const res = await request(app)
        .post(`/api/v1/support/tickets/${privateTicketId}/messages`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ message: 'Injecting a reply into somebody else ticket thread.' })

      expect(res.status).toBe(404)

      const messages = await prisma.supportMessage.findMany({
        where: { ticketId: privateTicketId },
      })
      expect(messages).toHaveLength(1)
      expect(messages[0].senderId).toBe(customerAId)
    })

    it('blocks a cross-customer close', async () => {
      const res = await request(app)
        .post(`/api/v1/support/tickets/${privateTicketId}/close`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ reason: 'Closing somebody else ticket maliciously.' })

      expect(res.status).toBe(404)

      const ticket = await prisma.supportTicket.findUnique({
        where: { id: privateTicketId },
        select: { status: true, closedAt: true },
      })
      expect(ticket!.status).toBe(TicketStatus.OPEN)
      expect(ticket!.closedAt).toBeNull()
    })

    it('blocks a cross-customer reopen', async () => {
      const res = await request(app)
        .post(`/api/v1/support/tickets/${privateTicketId}/reopen`)
        .set('Authorization', `Bearer ${customerBToken}`)

      expect(res.status).toBe(404)
    })
  })

  // ==========================================================
  // STAFF PERMISSIONS
  // ==========================================================

  describe('Staff permission enforcement', () => {
    it('refuses anonymous access to the staff inbox', async () => {
      const res = await request(app).get('/api/v1/admin/support/tickets')
      expect(res.status).toBe(401)
    })

    it.each([
      ['GET', '/api/v1/admin/support/tickets'],
      ['GET', '/api/v1/admin/support/overview'],
      ['GET', '/api/v1/admin/support/contact-submissions'],
    ])('refuses a permissionless staff account on %s %s', async (method, path) => {
      const res = await (request(app) as any)[method.toLowerCase()](path).set(
        'Authorization',
        `Bearer ${bareStaffToken}`
      )
      expect(res.status).toBe(403)
    })

    it('refuses a customer account on the staff inbox', async () => {
      const res = await request(app)
        .get('/api/v1/admin/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(res.status).toBe(403)
    })

    it('allows a permitted staff member to read the inbox', async () => {
      const res = await request(app)
        .get('/api/v1/admin/support/tickets')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.items)).toBe(true)
      expect(res.body.counts).toBeDefined()
    })

    it('refuses a permissionless staff member from changing status', async () => {
      const ticketId = await createTicket(customerAToken, {
        subject: 'Permission probe ticket',
        description: 'Created purely to verify staff permission boundaries.',
      })

      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${bareStaffToken}`)
        .send({ status: 'IN_PROGRESS' })

      expect(res.status).toBe(403)

      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { status: true },
      })
      expect(ticket!.status).toBe(TicketStatus.OPEN)

      await destroyTicket(ticketId)
    })

    it('refuses a permissionless staff member from replying', async () => {
      const ticketId = await createTicket(customerAToken)

      const res = await request(app)
        .post(`/api/v1/admin/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${bareStaffToken}`)
        .send({ message: 'I should not be allowed to work this ticket at all.' })

      expect(res.status).toBe(403)
      expect(
        await prisma.supportMessage.count({
          where: { ticketId, message: { contains: 'not be allowed' } },
        })
      ).toBe(0)

      await destroyTicket(ticketId)
    })
  })

  // ==========================================================
  // STAFF OPERATIONS + AUDIT
  // ==========================================================

  describe('Staff ticket operations and audit trail', () => {
    let ticketId: string

    beforeEach(async () => {
      ticketId = await createTicket(customerAToken, {
        subject: 'Refund not received for cancelled order',
        description: 'My order was cancelled but the refund has not appeared yet.',
        category: 'RETURN_REFUND',
        priority: 'HIGH',
      })
    })

    afterEach(async () => {
      await destroyTicket(ticketId)
    })

    it('moves to IN_PROGRESS and records the transition in the audit log', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'IN_PROGRESS', reason: 'Picked up by support desk' })

      expect(res.status).toBe(200)
      expect(res.body.data.ticket.status).toBe('IN_PROGRESS')
      expect(res.body.data.ticket.firstResponseAt).toBeTruthy()

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: ticketId, action: 'SUPPORT_TICKET_STATUS_CHANGED' },
      })
      expect(audit).not.toBeNull()
      const meta = audit!.metadata as any
      expect(meta.previousStatus).toBe('OPEN')
      expect(meta.newStatus).toBe('IN_PROGRESS')
      expect(meta.actorRole).toBe('STAFF')
      expect(audit!.actorId).toBe(staffId)
    })

    it('supports WAITING_FOR_CUSTOMER and audits it', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'WAITING_FOR_CUSTOMER', reason: 'Need the bank reference number' })

      expect(res.status).toBe(200)
      expect(res.body.data.ticket.status).toBe('WAITING_FOR_CUSTOMER')

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: ticketId, action: 'SUPPORT_TICKET_STATUS_CHANGED' },
      })
      expect((audit!.metadata as any).newStatus).toBe('WAITING_FOR_CUSTOMER')
    })

    it('rejects an illegal status transition', async () => {
      await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'CLOSED', closeReason: 'Resolved during triage sweep.' })

      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'IN_PROGRESS' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Illegal ticket status transition')
    })

    it('rejects a no-op status change', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'OPEN' })

      expect(res.status).toBe(409)
    })

    it('requires a resolution when marking RESOLVED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'RESOLVED' })

      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body.details)).toContain('resolution')
    })

    it('requires a close reason when marking CLOSED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'CLOSED' })

      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body.details)).toContain('closeReason')
    })

    it('resolves a ticket and records the resolution', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          status: 'RESOLVED',
          resolution: 'Refund of Rs. 1,250 initiated to the original payment method.',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.ticket.status).toBe('RESOLVED')
      expect(res.body.data.ticket.resolvedAt).toBeTruthy()
      expect(res.body.data.ticket.resolution).toContain('Refund of Rs. 1,250')
    })

    it('assigns a ticket to a staff member and audits the assignment', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ assignedStaffId: staffId })

      expect(res.status).toBe(200)
      expect(res.body.data.ticket.assignedStaffId).toBe(staffId)

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: ticketId, action: 'SUPPORT_TICKET_ASSIGNED' },
      })
      expect((audit!.metadata as any).newAssigneeId).toBe(staffId)
    })

    it('refuses to assign a ticket to a customer account', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ assignedStaffId: customerBId })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('staff, admin or owner')
    })

    it('lets staff reply and flips the ticket into IN_PROGRESS', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ message: 'We have raised the refund with your bank, expect it in 3 days.' })

      expect(res.status).toBe(200)
      expect(res.body.data.message.isStaff).toBe(true)
      expect(res.body.data.ticket.status).toBe('IN_PROGRESS')
      expect(res.body.data.ticket.firstResponseAt).toBeTruthy()
    })

    it('lets staff read any ticket regardless of which customer raised it', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/support/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.ticket.id).toBe(ticketId)
      expect(res.body.data.ticket.customerEmail).toBe(customerAEmail)
    })

    it('records an admin status change in the audit trail as PRIVILEGED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'IN_PROGRESS', reason: 'Escalated by platform administrator' })

      expect(res.status).toBe(200)

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: ticketId, action: 'SUPPORT_TICKET_STATUS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit!.actorId).toBe(adminId)
      expect((audit!.metadata as any).actorRole).toBe('PRIVILEGED')
      expect((audit!.metadata as any).reason).toBe('Escalated by platform administrator')
    })

    describe('internal note confidentiality', () => {
      const NOTE = 'INTERNAL ONLY: customer is a chargeback risk, do not disclose.'

      beforeEach(async () => {
        const res = await request(app)
          .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ status: 'IN_PROGRESS', internalNote: NOTE })
        expect(res.status).toBe(200)
      })

      it('hides internal notes from the customer ticket view', async () => {
        const res = await request(app)
          .get(`/api/v1/support/tickets/${ticketId}`)
          .set('Authorization', `Bearer ${customerAToken}`)

        expect(res.status).toBe(200)
        expect(JSON.stringify(res.body)).not.toContain('INTERNAL ONLY')
        expect(res.body.data.ticket.messageCount).toBe(1)
      })

      it('hides internal notes from the customer close/reopen responses', async () => {
        const closed = await request(app)
          .post(`/api/v1/support/tickets/${ticketId}/close`)
          .set('Authorization', `Bearer ${customerAToken}`)
          .send({ reason: 'Closing while I think about the refund.' })
        expect(closed.status).toBe(200)
        expect(JSON.stringify(closed.body)).not.toContain('INTERNAL ONLY')

        const reopened = await request(app)
          .post(`/api/v1/support/tickets/${ticketId}/reopen`)
          .set('Authorization', `Bearer ${customerAToken}`)
        expect(reopened.status).toBe(200)
        expect(JSON.stringify(reopened.body)).not.toContain('INTERNAL ONLY')
      })

      it('hides internal notes from the customer reply response', async () => {
        const res = await request(app)
          .post(`/api/v1/support/tickets/${ticketId}/messages`)
          .set('Authorization', `Bearer ${customerAToken}`)
          .send({ message: 'Any update on the refund you raised for me?' })

        expect(res.status).toBe(200)
        expect(JSON.stringify(res.body)).not.toContain('INTERNAL ONLY')
      })

      it('still shows internal notes to staff', async () => {
        const res = await request(app)
          .get(`/api/v1/admin/support/tickets/${ticketId}`)
          .set('Authorization', `Bearer ${staffToken}`)

        expect(res.status).toBe(200)
        expect(JSON.stringify(res.body)).toContain('INTERNAL ONLY')
      })
    })
  })

  // ==========================================================
  // EMAIL FAILURE HANDLING
  // ==========================================================

  describe('Email failure handling', () => {
    let ticketId: string

    beforeEach(async () => {
      ticketId = await createTicket(customerAToken, {
        subject: 'Email resilience probe',
        description: 'This ticket exists to verify email failure does not break the API.',
      })
    })

    afterEach(async () => {
      await destroyTicket(ticketId)
    })

    it('still creates the ticket when email dispatch fails', async () => {
      emailSpy.mockRejectedValue(new Error('sender not verified on provider account'))

      const otherId = await createTicket(customerAToken, {
        subject: 'Second email resilience probe',
        description: 'Another ticket created while the email provider is hard down for the account.',
      })

      const created = await prisma.supportTicket.findUniqueOrThrow({ where: { id: otherId } })
      expect(created.ticketNumber).toBeTruthy()
      expect(emailSpy).toHaveBeenCalled()

      const notifications = await prisma.supportNotification.findMany({
        where: { ticketId: otherId },
      })
      expect(notifications.length).toBeGreaterThan(0)
      expect(notifications.some((n) => n.status === 'FAILED')).toBe(true)

      await destroyTicket(otherId)
    })

    it('still accepts a customer reply when the notification email fails', async () => {
      emailSpy.mockRejectedValue(new Error('email provider throttled'))

      const res = await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: 'Following up while your mail system is broken, this must still work.' })

      expect(res.status).toBe(200)
      expect(res.body.data.message.id).toBeTruthy()
      expect(res.body.data.notified).toBe(false)

      expect(await prisma.supportMessage.count({ where: { ticketId } })).toBeGreaterThanOrEqual(2)

      const failed = await prisma.supportNotification.findMany({
        where: { ticketId, status: 'FAILED' },
      })
      expect(failed.length).toBeGreaterThan(0)
      expect(failed[0].error).toContain('email provider throttled')
    })

    it('exposes the delivery history, including failures, to permitted staff', async () => {
      emailSpy.mockRejectedValue(new Error('temporary failure'))

      await request(app)
        .post(`/api/v1/admin/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ message: 'Staff reply that will fail to send because the email provider is unavailable.' })

      const res = await request(app)
        .get(`/api/v1/admin/support/tickets/${ticketId}/notifications`)
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.total).toBeGreaterThan(0)
      expect(res.body.data.items.some((i: any) => i.status === 'FAILED')).toBe(true)
    })

    it('still stores a contact submission when its staff notification fails', async () => {
      emailSpy.mockRejectedValue(new Error('email provider unavailable'))

      const res = await request(app).post('/api/v1/contact').send({
        name: 'Mail Down Visitor',
        email: `maildown.${TAG}@example.com`,
        subject: 'Enquiry while mail is down',
        message: 'I am enquiring about your products at a time when email is broken.',
      })

      expect(res.status).toBe(201)

      const row = await prisma.contactSubmission.findUniqueOrThrow({
        where: { reference: res.body.data.reference },
      })
      expect(row.notifiedAt).toBeNull()
      expect(row.status).toBe('NEW')

      const notifications = await prisma.supportNotification.findMany({
        where: { contactId: row.id },
      })
      expect(notifications.some((n) => n.status === 'FAILED')).toBe(true)

      await destroyContact(row.id)
    })
  })

  // ==========================================================
  // EMAIL LOOP PREVENTION
  // ==========================================================

  describe('Email loop prevention', () => {
    it('never emails the support inbox back at a staff member', async () => {
      const ticketId = await createTicket(customerAToken, {
        subject: 'Loop guard probe one',
        description: 'Verifies that a staff reply never lands in the support inbox.',
      })

      await request(app)
        .post(`/api/v1/admin/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ message: 'This reply must not generate a support-inbox notification.' })

      const notifications = await prisma.supportNotification.findMany({
        where: { ticketId },
      })

      const staffReplies = notifications.filter((n) => n.messageId !== null)
      expect(staffReplies).toHaveLength(1)
      expect(staffReplies[0].recipientType).toBe('CUSTOMER')

      // Exactly one inbox notification exists: the original ticket-created alert.
      const inbox = notifications.filter((n) => n.recipientType === 'STAFF_INBOX')
      expect(inbox).toHaveLength(1)
      expect(inbox[0].messageId).toBeNull()

      await destroyTicket(ticketId)
    })

    it('never emails a customer back about their own reply', async () => {
      const ticketId = await createTicket(customerAToken, {
        subject: 'Loop guard probe two',
        description: 'Verifies that a customer reply never lands in their own inbox.',
      })

      await request(app)
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ message: 'My own reply must not trigger an email back to me.' })

      const customerNotifications = await prisma.supportNotification.findMany({
        where: { ticketId, recipientType: 'CUSTOMER' },
      })
      expect(customerNotifications).toHaveLength(0)

      await destroyTicket(ticketId)
    })

    it('collapses a duplicate dispatch for the same message onto one row', async () => {
      const ticketId = await createTicket(customerAToken, {
        subject: 'Loop guard probe three',
        description: 'Verifies duplicate dispatches collapse onto a single notification.',
      })
      const messageId = (
        await prisma.supportMessage.findFirstOrThrow({ where: { ticketId } })
      ).id

      const params = {
        ticketId,
        ticketNumber: 'TKT-LOOP-000001',
        messageId,
        subject: 'Loop guard probe three',
        staffName: 'Sita Support Agent',
        customerEmail: customerAEmail,
        status: TicketStatus.IN_PROGRESS,
      }

      const first = await SupportNotificationService.notifyCustomerOfStaffReply({
        ...params,
        message: 'Attempted dispatch number one for the same message id.',
      })
      const second = await SupportNotificationService.notifyCustomerOfStaffReply({
        ...params,
        message: 'Attempted dispatch number two for the same message id.',
      })

      expect(first.dedupeKey).toBe(second.dedupeKey)
      expect(second.status).toBe('SKIPPED')

      const rows = await prisma.supportNotification.findMany({
        where: { ticketId, messageId },
      })
      expect(rows).toHaveLength(1)

      await destroyTicket(ticketId)
    })

    it('skips dispatch when the recipient is the actor', async () => {
      const result = await SupportNotificationService.dispatchEmail({
        ticketId: null,
        contactId: null,
        recipient: `loop-guard.${TAG}@vedhicfoods.com`,
        audience: 'STAFF_INBOX',
        subject: 'Should be skipped',
        html: '<p>nope</p>',
        text: 'nope',
        eventKey: `LOOPGUARD:${TAG}`,
        actorEmail: `loop-guard.${TAG}@vedhicfoods.com`,
      })

      expect(result.status).toBe('SKIPPED')

      const row = await prisma.supportNotification.findUniqueOrThrow({
        where: { dedupeKey: result.dedupeKey },
      })
      expect(row.error).toBe('skipped_actor_is_recipient')

      await prisma.supportNotification.delete({ where: { id: row.id } })
    })

    it('skips dispatch for automated actors', async () => {
      const result = await SupportNotificationService.dispatchEmail({
        ticketId: null,
        contactId: null,
        recipient: `automated.${TAG}@vedhicfoods.com`,
        audience: 'STAFF_INBOX',
        subject: 'Should be skipped',
        html: '<p>nope</p>',
        text: 'nope',
        eventKey: `AUTOMATED:${TAG}`,
        actorEmail: 'webhook@vedhicfoods.com',
        actorIsAutomated: true,
      })

      expect(result.status).toBe('SKIPPED')

      const row = await prisma.supportNotification.findUniqueOrThrow({
        where: { dedupeKey: result.dedupeKey },
      })
      expect(row.error).toBe('skipped_automated_actor')

      await prisma.supportNotification.delete({ where: { id: row.id } })
    })

    it('opens the circuit breaker after repeated failures for one ticket', async () => {
      const ticketId = await createTicket(customerAToken, {
        subject: 'Circuit breaker probe',
        description: 'Verifies a permanently broken mailbox stops generating attempts.',
      })

      // Seed consecutive failures to trip the breaker.
      for (let i = 0; i < 5; i++) {
        await prisma.supportNotification.create({
          data: {
            ticketId,
            recipient: customerAEmail,
            recipientType: 'CUSTOMER',
            dedupeKey: `CIRCUIT-SEED:${TAG}:${i}`,
            status: 'FAILED',
            error: 'seeded failure',
          },
        })
      }

      expect(await SupportNotificationService.isSuppressed(ticketId)).toBe(true)

      const result = await SupportNotificationService.dispatchEmail({
        ticketId,
        recipient: `circuit.${TAG}@vedhicfoods.com`,
        audience: 'CUSTOMER',
        subject: 'Should be suppressed by the breaker',
        html: '<p>nope</p>',
        text: 'nope',
        eventKey: `CIRCUIT:${TAG}`,
      })
      expect(result.status).toBe('SKIPPED')

      await destroyTicket(ticketId)
    })
  })

  // ==========================================================
  // STAFF CONTACT INBOX
  // ==========================================================

  describe('Staff contact submission inbox', () => {
    let contactId: string

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/contact')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          name: 'Anita Customer',
          email: customerAEmail,
          subject: 'Please call me about my order',
          category: 'ORDER_ENQUIRY',
          phone: customerAPhone,
          message: 'I would prefer a phone call about the status of my order.',
        })
      expect(res.status).toBe(201)

      const row = await prisma.contactSubmission.findUniqueOrThrow({
        where: { reference: res.body.data.reference },
      })
      contactId = row.id
    })

    afterEach(async () => {
      await destroyContact(contactId)
    })

    it('lists submissions for permitted staff', async () => {
      const res = await request(app)
        .get('/api/v1/admin/support/contact-submissions')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items.some((s: any) => s.id === contactId)).toBe(true)
    })

    it('hides spam from the inbox by default', async () => {
      const spamRes = await request(app).post('/api/v1/contact').send({
        name: 'Spam Bot',
        email: `inboxspam.${TAG}@example.com`,
        subject: 'Cheap backlinks available',
        message: 'Buy backlinks now and make money fast with our SEO service.',
      })
      expect(spamRes.status).toBe(200)
      const spamRow = await prisma.contactSubmission.findUniqueOrThrow({
        where: { reference: spamRes.body.data.reference },
      })
      expect(spamRow.isSpam).toBe(true)

      const hidden = await request(app)
        .get('/api/v1/admin/support/contact-submissions')
        .set('Authorization', `Bearer ${staffToken}`)
      expect(hidden.body.items.some((s: any) => s.id === spamRow.id)).toBe(false)

      const shown = await request(app)
        .get('/api/v1/admin/support/contact-submissions?includeSpam=true')
        .set('Authorization', `Bearer ${staffToken}`)
      expect(shown.body.items.some((s: any) => s.id === spamRow.id)).toBe(true)

      await destroyContact(spamRow.id)
    })

    it('returns 404 for an unknown submission', async () => {
      const res = await request(app)
        .get('/api/v1/admin/support/contact-submissions/00000000-0000-4000-8000-0000000000ee')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(404)
    })

    it('triages a submission and audits the change', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/contact-submissions/${contactId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'TRIAGED', internalNotes: 'Called the customer, callback scheduled.' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('TRIAGED')
      expect(res.body.data.internalNotes).toBe('Called the customer, callback scheduled.')
      expect(res.body.data.triagedAt).toBeTruthy()

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: contactId, action: 'CONTACT_SUBMISSION_TRIAGED' },
      })
      expect(audit).not.toBeNull()
      expect((audit!.metadata as any).previousStatus).toBe('NEW')
      expect((audit!.metadata as any).newStatus).toBe('TRIAGED')
    })

    it('escalates a submission into a ticket owned by the customer', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/support/contact-submissions/${contactId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'TRIAGED', escalateToTicket: true })

      expect(res.status).toBe(200)
      const escalatedId = res.body.data.escalatedTicketId as string
      expect(escalatedId).toBeTruthy()

      const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: escalatedId } })
      expect(ticket.source).toBe('CONTACT_FORM')
      expect(ticket.userId).toBe(customerAId)

      const linked = await prisma.contactSubmission.findUniqueOrThrow({
        where: { id: contactId },
      })
      expect(linked.ticketId).toBe(escalatedId)

      // The escalated ticket is visible to the customer in their own list
      const mine = await request(app)
        .get('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(mine.body.items.some((t: any) => t.id === escalatedId)).toBe(true)

      await destroyTicket(escalatedId)
    })

    it('refuses to escalate a spam submission', async () => {
      await prisma.contactSubmission.update({
        where: { id: contactId },
        data: { isSpam: true, status: 'SPAM' },
      })

      const res = await request(app)
        .patch(`/api/v1/admin/support/contact-submissions/${contactId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'TRIAGED', escalateToTicket: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Spam submissions cannot be escalated')
    })

    it('refuses to escalate an anonymous submission onto an account', async () => {
      const anon = await request(app).post('/api/v1/contact').send({
        name: 'Anonymous Visitor',
        email: `anon-escalate.${TAG}@example.com`,
        subject: 'Please call me about my order',
        category: 'GENERAL',
        message: 'I would like to discuss an order I placed last week.',
      })
      expect(anon.status).toBe(201)
      const anonRow = await prisma.contactSubmission.findUniqueOrThrow({
        where: { reference: anon.body.data.reference },
      })
      expect(anonRow.userId).toBeNull()

      const res = await request(app)
        .patch(`/api/v1/admin/support/contact-submissions/${anonRow.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'TRIAGED', escalateToTicket: true })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('no registered account')

      await destroyContact(anonRow.id)
    })
  })

  // ==========================================================
  // OVERVIEW
  // ==========================================================

  describe('Support overview', () => {
    it('returns status and priority breakdowns for permitted staff', async () => {
      const res = await request(app)
        .get('/api/v1/admin/support/overview')
        .set('Authorization', `Bearer ${staffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.byStatus).toBeDefined()
      expect(res.body.data.openByPriority).toHaveLength(4)
      expect(res.body.data.unassignedOpen).toBeGreaterThanOrEqual(0)
    })
  })
})