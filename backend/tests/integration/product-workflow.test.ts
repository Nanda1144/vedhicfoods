import './_safety'
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'

const app = createApp()

describe('Catalog & Order Workflow Integration Tests', () => {
  let createdProductId: string
  let adminToken: string

  // Guest checkout rows persist across runs, so both email and phone must be
  // run-unique — a repeat of a previously-used value hits the account-exists /
  // unique-user checks and 401/500s.
  const timestamp = Date.now()
  const guestPhone = `91${String(timestamp).slice(-8)}`

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken
  }, 40000)

  it('GET /api/v1/products should fetch products list from PostgreSQL', async () => {
    const res = await request(app).get('/api/v1/products?per_page=5')

    expect(res.status).toBe(200)
    expect(res.body.items).toBeInstanceOf(Array)
    expect(res.body.page).toBe(1)
    expect(res.body.total).toBeGreaterThan(0)
  }, 30000)

  it('POST /api/v1/admin/products should create product in PostgreSQL', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Organic Forest Honey',
        price: 499,
        mrp: 599,
        unit: '500 g',
        stock: 50,
        sku: `SKU-TEST-${Date.now()}`,
        shortDescription: 'Fresh forest honey collected organically',
        description: 'Detailed description of forest honey',
        tags: ['honey', 'organic'],
        isOrganic: true,
        isFeatured: true,
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Test Organic Forest Honey')
    expect(res.body.price).toBe(499)
    createdProductId = res.body.id
  }, 30000)

  it('PUT /api/v1/admin/products/:id should update product in PostgreSQL and reflect in storefront', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Organic Forest Honey Updated',
        price: 450,
        stock: 45,
      })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Test Organic Forest Honey Updated')
    expect(res.body.price).toBe(450)

    // Verify it reflects in public GET /api/v1/products/:id
    const fetchRes = await request(app).get(`/api/v1/products/${createdProductId}`)
    expect(fetchRes.status).toBe(200)
    expect(fetchRes.body.name).toBe('Test Organic Forest Honey Updated')
    expect(fetchRes.body.price).toBe(450)
  }, 30000)

  it('POST /api/v1/orders/checkout should place order, create invoice, and respond with order details', async () => {
    const res = await request(app)
      .post('/api/v1/orders/checkout')
      .send({
        customerName: 'Aarav Patel',
        customerEmail: `aarav.patel.${timestamp}@example.com`,
        phone: guestPhone,
        addressLine: 'Flat 402, Lotus Towers, Baner',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411045',
        paymentMethod: 'COD',
        items: [
          {
            productId: createdProductId,
            quantity: 2,
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.orderNumber).toBeDefined()
    expect(res.body.invoiceId).toBeDefined()
    expect(res.body.total).toBeGreaterThan(0)
  }, 30000)

  it('DELETE /api/v1/admin/products/:id should remove test product from PostgreSQL', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/products/${createdProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  }, 30000)
})
