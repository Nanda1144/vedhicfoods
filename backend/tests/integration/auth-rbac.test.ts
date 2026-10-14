import './_safety'
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { RoleName } from '@prisma/client'

const app = createApp()

describe('Production Authentication & RBAC Authorization Integration Tests', () => {
  let customerToken: string
  let customerRefreshToken: string
  let customerId: string
  let otherCustomerToken: string
  let staffToken: string
  let adminToken: string
  let testOrderId: string

  const uniqueSuffix = Date.now()
  const customerEmail = `test.customer.${uniqueSuffix}@vedhicfoods.com`
  const otherCustomerEmail = `other.customer.${uniqueSuffix}@vedhicfoods.com`
  const staffEmail = `test.staff.${uniqueSuffix}@vedhicfoods.com`
  const testPassword = 'Password@123'

  beforeAll(async () => {
    // 1. Setup Other Customer for Cross-Account Isolation Tests
    const otherReg = await AuthService.register({
      fullName: 'Other Customer',
      email: otherCustomerEmail,
      password: testPassword,
    })
    otherCustomerToken = otherReg.accessToken

    // 2. Setup Staff User with Limited Permissions (orders.read only)
    const staffRole = await prisma.role.findUnique({ where: { name: RoleName.STAFF } })
    const staffUser = await prisma.user.create({
      data: {
        email: staffEmail,
        fullName: 'Test Order Fulfillment Staff',
        passwordHash: await AuthService.hashPassword(testPassword),
        role: RoleName.STAFF,
        isActive: true,
        isVerified: true,
      },
    })

    if (staffRole) {
      await prisma.userRole.create({
        data: { userId: staffUser.id, roleId: staffRole.id, assignedBy: 'SYSTEM_TEST' },
      })
    }

    const staffLogin = await AuthService.login({ email: staffEmail, password: testPassword })
    staffToken = staffLogin.accessToken

    // 3. Authenticate Seeded Admin
    const adminLogin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    adminToken = adminLogin.accessToken
  }, 80000)

  // =========================================================================
  // 1. REGISTRATION & INPUT VALIDATION
  // =========================================================================
  describe('Customer Registration Flow', () => {
    it('POST /api/v1/auth/register should create a new customer account with tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Test Customer User',
          email: customerEmail,
          password: testPassword,
          phone: `+9198765${uniqueSuffix.toString().slice(-5)}`,
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.user.email).toBe(customerEmail)
      expect(res.body.accessToken).toBeDefined()
      expect(res.body.refreshToken).toBeDefined()
      expect(res.body.user.passwordHash).toBeUndefined() // Password hash never exposed

      customerToken = res.body.accessToken
      customerRefreshToken = res.body.refreshToken
      customerId = res.body.user.id
    })

    it('POST /api/v1/auth/register should reject duplicate email registration with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Duplicate User',
          email: customerEmail,
          password: testPassword,
        })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already exists')
    })

    it('POST /api/v1/auth/register should reject weak password according to policy', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Weak Password User',
          email: `weak.${uniqueSuffix}@vedhicfoods.com`,
          password: 'short', // Fails min length & complexity
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Validation failed')
    })
  })

  // =========================================================================
  // 2. AUTHENTICATION & LOGIN SECURITY
  // =========================================================================
  describe('Authentication & Login Security', () => {
    it('POST /api/v1/auth/login should authenticate valid customer credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: customerEmail,
          password: testPassword,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.accessToken).toBeDefined()
      expect(res.body.refreshToken).toBeDefined()
      expect(res.body.user.id).toBe(customerId)
      expect(res.body.user.roles).toContain('CUSTOMER')
    })

    it('POST /api/v1/auth/login should reject incorrect password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: customerEmail,
          password: 'WrongPassword@999',
        })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Invalid email or password.')
    })

    it('POST /api/v1/auth/login should prevent user enumeration on non-existent email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent.user.random@vedhicfoods.com',
          password: 'SomePassword123',
        })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Invalid email or password.') // Uniform error response
    })
  })

  // =========================================================================
  // 3. CURRENT USER PROFILE & CONTEXT
  // =========================================================================
  describe('Current User Context (GET /api/v1/auth/me)', () => {
    it('GET /api/v1/auth/me should return authenticated user identity and permissions', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${customerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(customerId)
      expect(res.body.email).toBe(customerEmail)
      expect(res.body.roles).toBeInstanceOf(Array)
      expect(res.body.permissions).toBeInstanceOf(Array)
      expect(res.body.passwordHash).toBeUndefined()
    })

    it('GET /api/v1/auth/me should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/auth/me')
      expect(res.status).toBe(401)
    })

    it('GET /api/v1/auth/me should reject malformed or tampered JWT with 401', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.tampered.jwt-signature-token')

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Invalid')
    })
  })

  // =========================================================================
  // 4. REFRESH TOKEN ROTATION & REUSE ATTACK DETECTION
  // =========================================================================
  describe('Refresh Token Rotation & Security', () => {
    it('POST /api/v1/auth/refresh should rotate refresh token and issue new access token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: customerRefreshToken })

      expect(res.status).toBe(200)
      expect(res.body.accessToken).toBeDefined()
      expect(res.body.refreshToken).toBeDefined()
      expect(res.body.refreshToken).not.toBe(customerRefreshToken) // Rotated
    })

    it('POST /api/v1/auth/refresh should detect stolen token reuse and invalidate session', async () => {
      // Re-using the already revoked customerRefreshToken
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: customerRefreshToken })

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Compromised session token detected')
    })
  })

  // =========================================================================
  // 5. ROLE-BASED ACCESS CONTROL (RBAC) & PERMISSION ENFORCEMENT
  // =========================================================================
  describe('RBAC & Granular Permission Enforcement', () => {
    it('Customer should be forbidden from accessing admin endpoints (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/payment-settings')
        .set('Authorization', `Bearer ${customerToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    })

    it('Staff without products.create permission should be forbidden from creating products (403)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Unauthorized Staff Product',
          price: 199,
          mrp: 249,
          unit: '500g',
          stock: 10,
        })

      expect(res.status).toBe(403)
      // Permission slugs are deliberately not echoed to clients (reconnaissance).
      expect(res.body.error).toContain('Forbidden')
    })

    it('Admin with full permissions should be allowed to view payment settings (200 OK)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/payment-settings')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.provider).toBe('razorpay')
    })

    it('Admin should be allowed to view admin order management (200 OK)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.items).toBeInstanceOf(Array)
      expect(res.body.pagination).toBeDefined()
    })
  })

  // =========================================================================
  // 6. CUSTOMER ISOLATION & RESOURCE-LEVEL AUTHORIZATION
  // =========================================================================
  describe('Customer Data Isolation', () => {
    it('Customer A should create an order successfully', async () => {
      const inStockInventory = await prisma.inventory.findFirst({
      where: {
        availableQuantity: { gt: 0 },
        product: { isDeleted: false, isActive: true, status: 'PUBLISHED' },
      },
      include: { product: true },
    })
    const firstProduct = inStockInventory?.product
      expect(firstProduct).toBeDefined()

      const res = await request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          customerName: 'Customer A',
          customerEmail: customerEmail,
          phone: '+919876543210',
          address: {
            fullName: 'Customer A',
            phone: '+919876543210',
            line1: 'Test Address 123',
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500001',
            country: 'India',
          },
          paymentMethod: 'COD',
          items: [{ productId: firstProduct!.id, quantity: 1 }],
        })

      expect(res.status).toBe(201)
      expect(res.body.orderId).toBeDefined()
      testOrderId = res.body.orderId
    })

    it('Customer A should be allowed to view their own order (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${testOrderId}`)
        .set('Authorization', `Bearer ${customerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testOrderId)
    })

    it('Customer B should be FORBIDDEN from viewing Customer A order (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${testOrderId}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    })

    it('Customer A should be able to list their own order history (GET /my-orders)', async () => {
      const res = await request(app)
        .get('/api/v1/orders/my-orders')
        .set('Authorization', `Bearer ${customerToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items).toBeInstanceOf(Array)
      expect(res.body.items.some((o: any) => o.id === testOrderId)).toBe(true)
    })
  })

  // =========================================================================
  // 7. STAFF MANAGEMENT & OWNER SAFEGUARDS
  // =========================================================================
  describe('Staff Management & Safeguards', () => {
    let createdStaffId: string
    const newStaffEmail = `new.staff.${uniqueSuffix}@vedhicfoods.com`

    it('Admin with staff.create permission should create staff account', async () => {
      const res = await request(app)
        .post('/api/v1/admin/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'New Fulfillment Staff',
          email: newStaffEmail,
          password: 'StaffPassword@123',
          role: RoleName.STAFF,
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.staff.email).toBe(newStaffEmail)
      createdStaffId = res.body.staff.id
    })

    it('Admin should be able to view staff directory (GET /api/v1/admin/staff)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/staff')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items).toBeInstanceOf(Array)
      expect(res.body.items.some((s: any) => s.id === createdStaffId)).toBe(true)
    })

    it('Admin should be able to update staff status (PATCH /api/v1/admin/staff/:id)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/staff/${createdStaffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })

      expect(res.status).toBe(200)
      expect(res.body.staff.isActive).toBe(false)
    })

    it('Admin should be able to soft-delete staff (DELETE /api/v1/admin/staff/:id)', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/staff/${createdStaffId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  // =========================================================================
  // 8. PASSWORD RESET & EMAIL VERIFICATION
  // =========================================================================
  describe('Password Reset & Email Verification Flow', () => {
    let resetToken: string

    it('POST /api/v1/auth/forgot-password should generate reset token for existing account', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: customerEmail })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.resetToken).toBeDefined()
      resetToken = res.body.resetToken
    })

    it('POST /api/v1/auth/reset-password should successfully reset password and enable login', async () => {
      const newPassword = 'NewSecretPassword@2026'

      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          newPassword,
        })

      expect(resetRes.status).toBe(200)
      expect(resetRes.body.success).toBe(true)

      // Verify login with new password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: customerEmail,
          password: newPassword,
        })

      expect(loginRes.status).toBe(200)
      expect(loginRes.body.accessToken).toBeDefined()
    })
  })
})
