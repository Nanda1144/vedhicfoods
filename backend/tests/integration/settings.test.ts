import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { RoleName, SettingCategory } from '@prisma/client'

const app = createApp()

describe('Centralized Platform Settings Integration Tests', () => {
  const uniqueSuffix = Date.now()
  const testPassword = 'Password@123'

  let adminToken: string
  let customerToken: string
  let settingsReaderToken: string
  let settingsReaderId: string

  // The STAFF role is narrowed to a single permission below so the read/write
  // split can be proven. That mutation is global and long-lived, so the original
  // grant set is snapshotted and restored in afterAll; otherwise every suite that
  // runs afterwards loses its staff permissions.
  let narrowedStaffRoleId: string | null = null
  let originalStaffPermissions: { permissionId: string }[] = []

  // Keys created exclusively for this suite so cleanup is safe.
  const TEST_KEYS = [
    'test_business_name_public',
    'test_support_email_public',
    'test_invoice_terms_private',
    'test_store_status_public',
  ]

  beforeAll(async () => {
    // 1. Seeded administrator (full settings.read + settings.update via ADMIN role).
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    // 2. Customer token -> must never reach the private settings API.
    const customer = await AuthService.register({
      fullName: 'Settings Probe Customer',
      email: `settings.customer.${uniqueSuffix}@vedhicfoods.com`,
      password: testPassword,
    })
    customerToken = customer.accessToken

    // 3. A staff account granted ONLY settings.read (no settings.update).
    //    This proves granular permissions, not just role membership, gate writes.
    const settingsReadPermission = await prisma.permission.findUnique({
      where: { slug: 'settings.read' },
    })

    const reader = await prisma.user.create({
      data: {
        email: `settings.reader.${uniqueSuffix}@vedhicfoods.com`,
        fullName: 'Settings Read Only Staff',
        passwordHash: await AuthService.hashPassword(testPassword),
        role: RoleName.STAFF,
        isActive: true,
        isVerified: true,
      },
    })
    settingsReaderId = reader.id

    if (settingsReadPermission) {
      // Attach to existing STAFF role, then restrict it to only settings.read
      const staffRole = await prisma.role.findUnique({ where: { name: RoleName.STAFF } })

      if (staffRole) {
        narrowedStaffRoleId = staffRole.id
        originalStaffPermissions = await prisma.rolePermission.findMany({
          where: { roleId: staffRole.id },
          select: { permissionId: true },
        })

        await prisma.userRole.create({
          data: {
            userId: reader.id,
            roleId: staffRole.id,
            assignedBy: 'SYSTEM_TEST',
          },
        })

        await prisma.rolePermission.deleteMany({ where: { roleId: staffRole.id } })
        await prisma.rolePermission.create({
          data: { roleId: staffRole.id, permissionId: settingsReadPermission.id },
        })
      }
    }

    const readerLogin = await AuthService.login({
      email: `settings.reader.${uniqueSuffix}@vedhicfoods.com`,
      password: testPassword,
    })
    settingsReaderToken = readerLogin.accessToken
  }, 120000)

  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: { in: TEST_KEYS } } })
    if (settingsReaderId) {
      await prisma.user.deleteMany({ where: { id: settingsReaderId } })
    }
    if (narrowedStaffRoleId) {
      await prisma.rolePermission.deleteMany({ where: { roleId: narrowedStaffRoleId } })
      if (originalStaffPermissions.length > 0) {
        await prisma.rolePermission.createMany({
          data: originalStaffPermissions.map((row) => ({
            roleId: narrowedStaffRoleId as string,
            permissionId: row.permissionId,
          })),
        })
      }
    }
  })

  // =========================================================================
  // 1. PERMISSIONS
  // =========================================================================
  describe('Authorization & granular permissions', () => {
    it('GET /api/v1/admin/settings should reject anonymous requests with 401', async () => {
      const res = await request(app).get('/api/v1/admin/settings')
      expect(res.status).toBe(401)
    })

    it('GET /api/v1/admin/settings should reject customers with 403 (no settings.read)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${customerToken}`)

      expect(res.status).toBe(403)
      // Permission slugs are deliberately not echoed to clients (reconnaissance).
      expect(res.body.error).toContain('Forbidden')
    })

    it('PUT /api/v1/admin/settings should reject customers with 403 (no settings.update)', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ settings: [{ key: 'test_business_name_public', value: 'Hacked' }] })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    })

    it('GET /api/v1/admin/settings should allow a user holding only settings.read', async () => {
      const res = await request(app)
        .get('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${settingsReaderToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items).toBeInstanceOf(Array)
    })

    it('PUT /api/v1/admin/settings should forbid a user holding only settings.read', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${settingsReaderToken}`)
        .send({ settings: [{ key: 'test_business_name_public', value: 'Escalated' }] })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    })

    it('PUT /api/v1/admin/settings/:key should also enforce settings.update', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings/test_business_name_public')
        .set('Authorization', `Bearer ${settingsReaderToken}`)
        .send({ value: 'Escalated' })

      expect(res.status).toBe(403)
    })

    it('Admin with settings.update should be able to read and write settings', async () => {
      const read = await request(app)
        .get('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(read.status).toBe(200)

      const write = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          settings: [
            {
              key: 'test_business_name_public',
              value: 'Vedhic Foods India Pvt Ltd',
              category: SettingCategory.BUSINESS,
              description: 'Registered business legal entity',
              isPublic: true,
            },
          ],
        })

      expect(write.status).toBe(200)
      expect(write.body.success).toBe(true)
    })
  })

  // =========================================================================
  // 2. VALIDATION
  // =========================================================================
  describe('Payload validation', () => {
    it('should reject a non-array settings payload with 400', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settings: 'not-an-array' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Validation failed')
    })

    it('should reject an empty settings array with 400', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settings: [] })

      expect(res.status).toBe(400)
    })

    it('should reject a settings entry without a key', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settings: [{ value: 'no key provided' }] })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Validation failed')
    })

    it('should reject an invalid SettingCategory enum value', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settings: [{ key: 'test_invalid_category', value: 'x', category: 'NOT_A_CATEGORY' }] })

      expect(res.status).toBe(400)
    })

    it('should reject PUT /:key without a value', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings/test_business_name_public')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'no value supplied' })

      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // 3. SECRET EXCLUSION (never store credentials in generic settings)
  // =========================================================================
  describe('Secret exclusion guardrails', () => {
    const secretKeys = [
      'razorpay_secret',
      'RAZORPAY_KEY_SECRET',
      'razorpay_webhook_secret',
      'aws_secret_access_key',
      'jwt_secret',
      'database_password',
      'DATABASE_URL',
      'encryption_key',
    ]

    for (const key of secretKeys) {
      it(`should refuse to persist the secret key "${key}"`, async () => {
        const res = await request(app)
          .put('/api/v1/admin/settings')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ settings: [{ key, value: 'super-secret-value' }] })

        expect(res.status).toBe(400)
        expect(res.body.error).toContain('secret')

        const persisted = await prisma.systemSetting.findUnique({ where: { key } })
        expect(persisted).toBeNull()
      })
    }

    it('should refuse a nested secret key inside an object value', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          settings: [{ key: 'test_gateway_config', value: { provider: 'razorpay', jwt_secret: 'leak' } }],
        })

      expect(res.status).toBe(400)

      const persisted = await prisma.systemSetting.findUnique({ where: { key: 'test_gateway_config' } })
      expect(persisted).toBeNull()

      await prisma.systemSetting.deleteMany({ where: { key: 'test_gateway_config' } })
    })

    it('GET /api/v1/settings must never expose private settings', async () => {
      await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          settings: [
            { key: 'test_invoice_terms_private', value: 'Private legal terms', category: SettingCategory.INVOICE, isPublic: false },
            { key: 'test_support_email_public', value: 'help@vedhicfoods.com', category: SettingCategory.GENERAL, isPublic: true },
          ],
        })

      const res = await request(app).get('/api/v1/settings')

      expect(res.status).toBe(200)
      expect(res.body.data.test_support_email_public).toBe('help@vedhicfoods.com')
      expect(res.body.data.test_invoice_terms_private).toBeUndefined()
    })
  })

  // =========================================================================
  // 4. PUBLIC / PRIVATE SEPARATION
  // =========================================================================
  describe('Public vs private separation', () => {
    it('GET /api/v1/settings should require no authentication and return safe data', async () => {
      const res = await request(app).get('/api/v1/settings')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toBeInstanceOf(Object)
    })

    it('public payload must not leak invoice terms, GST rate or S3 logo key', async () => {
      const res = await request(app).get('/api/v1/settings')

      expect(res.body.data.invoice_terms).toBeUndefined()
      expect(res.body.data.invoice_seller_notes).toBeUndefined()
      expect(res.body.data.gst_rate_percent).toBeUndefined()
      expect(res.body.data.brand_logo_s3_key).toBeUndefined()
      expect(res.body.data.shipping_codable_pincode_prefixes).toBeUndefined()
    })

    it('public payload should include store status and maintenance flags', async () => {
      const res = await request(app).get('/api/v1/settings')

      expect(res.body.data.store_status).toBeDefined()
      expect(res.body.data.maintenance_mode).toBeDefined()
    })

    it('GET /api/v1/admin/settings should include private keys that the public API hides', async () => {
      const res = await request(app)
        .get('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const keys: string[] = res.body.items.map((s: any) => s.key)
      expect(keys).toContain('invoice_terms')
      expect(keys).toContain('gst_rate_percent')
    })

    it('GET /api/v1/admin/settings/:key should 404 for an unknown key', async () => {
      const res = await request(app)
        .get('/api/v1/admin/settings/definitely_missing_key_xyz')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(404)
    })

    it('public API must never return a value flagged isPublic=false even if it exists', async () => {
      await request(app)
        .put('/api/v1/admin/settings/test_store_status_public')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'PRE_ORDER', category: SettingCategory.GENERAL, isPublic: true })

      const publicRes = await request(app).get('/api/v1/settings')
      expect(publicRes.body.data.test_store_status_public).toBe('PRE_ORDER')

      // Flip it private and confirm it disappears from the public surface.
      await request(app)
        .put('/api/v1/admin/settings/test_store_status_public')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'PRE_ORDER', isPublic: false })

      const afterRes = await request(app).get('/api/v1/settings')
      expect(afterRes.body.data.test_store_status_public).toBeUndefined()
    })
  })

  // =========================================================================
  // 5. AUDIT LOGGING
  // =========================================================================
  describe('Audit logging of sensitive settings changes', () => {
    it('should record a SETTING_CREATED audit entry on first write', async () => {
      await prisma.systemSetting.deleteMany({ where: { key: 'test_support_email_public' } })
      await prisma.auditLog.deleteMany({ where: { entityId: 'test_support_email_public' } })

      await request(app)
        .put('/api/v1/admin/settings/test_support_email_public')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'audit-created@vedhicfoods.com', category: SettingCategory.GENERAL, isPublic: true })

      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'SystemSetting', entityId: 'test_support_email_public', action: 'SETTING_CREATED' },
        orderBy: { createdAt: 'desc' },
      })

      expect(entry).not.toBeNull()
      expect(entry?.actorEmail).toBe('admin@vedhicfoods.com')
      expect(entry?.ipAddress).toBeTruthy()
    })

    it('should record a SETTING_UPDATED audit entry including previous and new values', async () => {
      await prisma.auditLog.deleteMany({ where: { entityId: 'test_support_email_public' } })

      await request(app)
        .put('/api/v1/admin/settings/test_support_email_public')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'audit-updated@vedhicfoods.com', isPublic: true })

      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'SystemSetting', entityId: 'test_support_email_public', action: 'SETTING_UPDATED' },
        orderBy: { createdAt: 'desc' },
      })

      expect(entry).not.toBeNull()
      const metadata = entry?.metadata as Record<string, any>
      expect(metadata.previousValue).toBe('audit-created@vedhicfoods.com')
      expect(metadata.newValue).toBe('audit-updated@vedhicfoods.com')
    })

    it('should record a SETTINGS_BULK_UPDATED audit entry for bulk writes', async () => {
      await prisma.auditLog.deleteMany({ where: { entity: 'SystemSetting', action: 'SETTINGS_BULK_UPDATED' } })

      await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          settings: [
            { key: 'test_business_name_public', value: 'Bulk Co', isPublic: true },
            { key: 'test_store_status_public', value: 'OPEN', isPublic: true },
          ],
        })

      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'SystemSetting', action: 'SETTINGS_BULK_UPDATED' },
        orderBy: { createdAt: 'desc' },
      })

      expect(entry).not.toBeNull()
      const metadata = entry?.metadata as Record<string, any>
      expect(Array.isArray(metadata.keys)).toBe(true)
      expect(metadata.keys).toContain('test_business_name_public')
      expect(metadata.changes).toBeInstanceOf(Array)
    })

    it('should NOT write an audit entry when the request is rejected by validation', async () => {
      await prisma.auditLog.deleteMany({ where: { entityId: 'test_business_name_public' } })

      await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settings: [] })

      const entries = await prisma.auditLog.count({ where: { entityId: 'test_business_name_public' } })
      expect(entries).toBe(0)
    })

    it('should NOT write an audit entry when a customer attempts an unauthorized write', async () => {
      await prisma.auditLog.deleteMany({ where: { entityId: 'test_business_name_public' } })

      await request(app)
        .put('/api/v1/admin/settings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ settings: [{ key: 'test_business_name_public', value: 'Hacked' }] })

      const entries = await prisma.auditLog.count({ where: { entityId: 'test_business_name_public' } })
      expect(entries).toBe(0)
    })

    it('audit metadata must never contain raw secret values', async () => {
      const entries = await prisma.auditLog.findMany({
        where: { entity: 'SystemSetting' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })

      for (const entry of entries) {
        const serialised = JSON.stringify(entry.metadata)
        expect(serialised).not.toContain('super-secret-value')
        expect(serialised).not.toContain('leak')
      }
    })
  })
})
