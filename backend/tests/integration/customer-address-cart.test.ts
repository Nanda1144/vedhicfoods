import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'

const app = createApp()

describe('Customer Address & Authoritative Cart Integration Tests', () => {
  let adminToken: string
  let customerAToken: string
  let customerAId: string
  let customerBToken: string
  let customerBId: string
  let activeProductId: string
  let highPricedProductId: string
  let outOfStockProductId: string
  let inactiveProductId: string

  const timestamp = Date.now()

  beforeAll(async () => {
    // 1. Admin login for catalog provisioning
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    // 2. Customer A
    const emailA = `customer.a.${timestamp}@vedhicfoods.com`
    const regA = await AuthService.register({
      fullName: 'Customer Alice',
      email: emailA,
      password: 'CustomerA@Vedhic2026!',
    })
    customerAToken = regA.accessToken
    customerAId = regA.user.id

    // 3. Customer B (for cross-user isolation testing)
    const emailB = `customer.b.${timestamp}@vedhicfoods.com`
    const regB = await AuthService.register({
      fullName: 'Customer Bob',
      email: emailB,
      password: 'CustomerB@Vedhic2026!',
    })
    customerBToken = regB.accessToken
    customerBId = regB.user.id

    // 4. Provision category
    const catRes = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Cart Category ${timestamp}`,
        slug: `cart-cat-${timestamp}`,
      })
    const categoryId = catRes.body.id || catRes.body.category?.id || catRes.body.data?.id

    // 5. Active in-stock product (Price: Rs. 200, MRP: Rs. 250, Stock: 20)
    const p1 = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `A2 Desi Cow Ghee ${timestamp}`,
        slug: `a2-ghee-${timestamp}`,
        sku: `SKU-GHEE-${timestamp}`,
        categoryId,
        price: 200,
        mrp: 250,
        stock: 20,
      })
    activeProductId = p1.body.id || p1.body.product?.id || p1.body.data?.id

    // 6. High priced product to test free shipping (Price: Rs. 600, MRP: Rs. 700, Stock: 10)
    const p2 = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Organic Saffron Pack ${timestamp}`,
        slug: `saffron-${timestamp}`,
        sku: `SKU-SAFFRON-${timestamp}`,
        categoryId,
        price: 600,
        mrp: 700,
        stock: 10,
      })
    highPricedProductId = p2.body.id || p2.body.product?.id || p2.body.data?.id

    // 7. Out of stock product (Stock: 0)
    const p3 = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Rare Herbal Elixir ${timestamp}`,
        slug: `elixir-${timestamp}`,
        sku: `SKU-ELIXIR-${timestamp}`,
        categoryId,
        price: 150,
        mrp: 180,
        stock: 0,
      })
    outOfStockProductId = p3.body.id || p3.body.product?.id || p3.body.data?.id

    // 8. Inactive product (status: DRAFT, isActive: false)
    const p4 = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Unpublished Special Herb ${timestamp}`,
        slug: `herb-${timestamp}`,
        sku: `SKU-HERB-${timestamp}`,
        categoryId,
        price: 99,
        mrp: 120,
        stock: 50,
        status: 'DRAFT',
      })
    inactiveProductId = p4.body.id || p4.body.product?.id || p4.body.data?.id
    // Explicitly deactivate to guarantee isActive = false
    await prisma.product.update({
      where: { id: inactiveProductId },
      data: { isActive: false },
    })
  })

  afterAll(async () => {
    // Cleanup products and test users
    await prisma.cartItem.deleteMany({
      where: {
        product: {
          id: { in: [activeProductId, highPricedProductId, outOfStockProductId, inactiveProductId] },
        },
      },
    }).catch(() => {})

    await prisma.address.deleteMany({
      where: { userId: { in: [customerAId, customerBId] } },
    }).catch(() => {})

    await prisma.cart.deleteMany({
      where: { userId: { in: [customerAId, customerBId] } },
    }).catch(() => {})

    await prisma.product.deleteMany({
      where: { id: { in: [activeProductId, highPricedProductId, outOfStockProductId, inactiveProductId] } },
    }).catch(() => {})

    await prisma.user.deleteMany({
      where: { id: { in: [customerAId, customerBId] } },
    }).catch(() => {})
  })

  // =========================================================================
  // 1. CUSTOMER ADDRESS MANAGEMENT
  // =========================================================================
  describe('Customer Address Management Flow & Ownership Safeguards', () => {
    let addressA1Id: string
    let addressA2Id: string

    it('POST /api/v1/customer/addresses should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/customer/addresses')
        .send({ fullName: 'Nobody' })

      expect(res.status).toBe(401)
    })

    it('POST /api/v1/customer/addresses should validate required address fields', async () => {
      const res = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          // Missing phone, line1, city, state, pincode
          fullName: 'A', // Too short
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('POST /api/v1/customer/addresses should reject invalid Indian phone and pincode format', async () => {
      const res1 = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          fullName: 'Alice Sharma',
          phone: '12345', // Invalid phone
          line1: '123 Greenfield Lane',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001',
        })
      expect(res1.status).toBe(400)

      const res2 = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          fullName: 'Alice Sharma',
          phone: '9876543210',
          line1: '123 Greenfield Lane',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '012345', // Starts with 0 - invalid PIN
        })
      expect(res2.status).toBe(400)
    })

    it('POST /api/v1/customer/addresses should create first address and automatically set as default', async () => {
      const res = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          label: 'Home',
          fullName: 'Alice Sharma',
          phone: '9876543210',
          line1: 'Flat 401, Vedhic Heights',
          line2: 'Banjara Hills Road No 12',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500034',
          country: 'India',
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.id).toBeDefined()
      expect(res.body.data.isDefault).toBe(true) // Automatically default because it's first
      addressA1Id = res.body.data.id
    })

    it('POST /api/v1/customer/addresses should create a second address with isDefault: false by default', async () => {
      const res = await request(app)
        .post('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          label: 'Office',
          fullName: 'Alice Sharma',
          phone: '9876543210',
          line1: 'Tech Park, HITEC City',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500081',
          isDefault: false,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.isDefault).toBe(false)
      addressA2Id = res.body.data.id

      // Verify first address is STILL default
      const checkA1 = await prisma.address.findUnique({ where: { id: addressA1Id } })
      expect(checkA1?.isDefault).toBe(true)
    })

    it('GET /api/v1/customer/addresses should return customer addresses with default address first', async () => {
      const res = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
      expect(res.body.items[0].id).toBe(addressA1Id)
      expect(res.body.items[0].isDefault).toBe(true)
      expect(res.body.items[1].id).toBe(addressA2Id)
      expect(res.body.items[1].isDefault).toBe(false)
    })

    it('GET /api/v1/customer/addresses/:id should fetch single address by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/customer/addresses/${addressA1Id}`)
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.line1).toBe('Flat 401, Vedhic Heights')
    })

    it('PATCH /api/v1/customer/addresses/:id/default should promote second address and demote first', async () => {
      const res = await request(app)
        .patch(`/api/v1/customer/addresses/${addressA2Id}/default`)
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.isDefault).toBe(true)

      // Verify in DB that addressA1 is no longer default
      const checkA1 = await prisma.address.findUnique({ where: { id: addressA1Id } })
      expect(checkA1?.isDefault).toBe(false)
    })

    it('PATCH /api/v1/customer/addresses/:id should update address fields', async () => {
      const res = await request(app)
        .patch(`/api/v1/customer/addresses/${addressA1Id}`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          landmark: 'Opposite GVK Mall',
          city: 'Hyderabad',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.landmark).toBe('Opposite GVK Mall')
    })

    // Strict Cross-Customer Ownership Checks
    it('Customer B should be FORBIDDEN from viewing Customer A address', async () => {
      const res = await request(app)
        .get(`/api/v1/customer/addresses/${addressA1Id}`)
        .set('Authorization', `Bearer ${customerBToken}`)

      expect([403, 404]).toContain(res.status)
    })

    it('Customer B should be FORBIDDEN from modifying Customer A address', async () => {
      const res = await request(app)
        .patch(`/api/v1/customer/addresses/${addressA1Id}`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ line1: 'Malicious Change' })

      expect([403, 404]).toContain(res.status)
    })

    it('Customer B should be FORBIDDEN from deleting Customer A address', async () => {
      const res = await request(app)
        .delete(`/api/v1/customer/addresses/${addressA1Id}`)
        .set('Authorization', `Bearer ${customerBToken}`)

      expect([403, 404]).toContain(res.status)
    })

    it('DELETE /api/v1/customer/addresses/:id should safely soft-delete and promote remaining address to default', async () => {
      // Currently addressA2 is default, addressA1 is not
      const deleteRes = await request(app)
        .delete(`/api/v1/customer/addresses/${addressA2Id}`)
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(deleteRes.status).toBe(200)

      // Verify addressA2 is soft-deleted
      const checkA2 = await prisma.address.findUnique({ where: { id: addressA2Id } })
      expect(checkA2?.isDeleted).toBe(true)

      // Verify addressA1 is now promoted to default!
      const checkA1 = await prisma.address.findUnique({ where: { id: addressA1Id } })
      expect(checkA1?.isDefault).toBe(true)

      // Verify list only returns active addresses
      const listRes = await request(app)
        .get('/api/v1/customer/addresses')
        .set('Authorization', `Bearer ${customerAToken}`)
      expect(listRes.body.count).toBe(1)
      expect(listRes.body.items[0].id).toBe(addressA1Id)
    })
  })

  // =========================================================================
  // 2. AUTHORITATIVE CART MANAGEMENT & VALIDATION
  // =========================================================================
  describe('Authoritative Cart Operations, Stock Gates & Financial Precision', () => {
    it('GET /api/v1/cart should initialize empty cart with zero totals', async () => {
      const res = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.itemCount).toBe(0)
      expect(res.body.subtotal).toBe(0)
      expect(res.body.shipping).toBe(0)
      expect(res.body.tax).toBe(0)
      expect(res.body.total).toBe(0)
    })

    it('POST /api/v1/cart/items should reject non-existent product with 404', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: 'non-existent-product-id-12345',
          quantity: 1,
        })

      expect(res.status).toBe(404)
    })

    it('POST /api/v1/cart/items should reject inactive/draft product with 400', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: inactiveProductId,
          quantity: 1,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('unavailable')
    })

    it('POST /api/v1/cart/items should reject out-of-stock product with 400', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: outOfStockProductId,
          quantity: 1,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('out of stock')
    })

    it('POST /api/v1/cart/items should reject quantity <= 0 with 400', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: activeProductId,
          quantity: 0,
        })

      expect(res.status).toBe(400)
    })

    it('POST /api/v1/cart/items should reject excess quantity exceeding available inventory', async () => {
      // activeProductId stock is 20
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: activeProductId,
          quantity: 50, // Exceeds 20
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('exceeds authoritative available stock')
    })

    it('POST /api/v1/cart/items should IGNORE frontend price manipulation and use PostgreSQL price', async () => {
      // Product price in DB is 200, MRP is 250. Client sends fake price: 5
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: activeProductId,
          quantity: 2,
          price: 5, // FAKE PRICE MANIPULATION
          discount: 100, // FAKE DISCOUNT
          total: 10, // FAKE TOTAL
        })

      expect(res.status).toBe(200)
      const item = res.body.items[0]
      expect(item.unitPrice).toBe(200) // Authoritative price from DB
      expect(item.lineTotal).toBe(400) // 2 * 200 = 400
      expect(item.lineSavings).toBe(100) // (250 - 200) * 2 = 100

      // Financial totals verification for Subtotal < 499:
      // Subtotal: 400
      // Shipping: 49 (because 400 < 499)
      // Tax: 5% of 400 = 20
      // Final Total: 400 + 49 + 20 = 469
      expect(res.body.subtotal).toBe(400)
      expect(res.body.shipping).toBe(49)
      expect(res.body.tax).toBe(20)
      expect(res.body.total).toBe(469)
    })

    it('POST /api/v1/cart/items should qualify for free shipping when subtotal >= 499', async () => {
      // Adding highPricedProductId (Rs. 600)
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          productId: highPricedProductId,
          quantity: 1,
        })

      expect(res.status).toBe(200)
      // Subtotal: 400 + 600 = 1000 >= 499 -> shipping must be 0
      expect(res.body.subtotal).toBe(1000)
      expect(res.body.shipping).toBe(0)
      // Tax: 5% of 1000 = 50
      expect(res.body.tax).toBe(50)
      // Total: 1000 + 0 + 50 = 1050
      expect(res.body.total).toBe(1050)
    })

    it('PATCH /api/v1/cart/items/:itemId should update item quantity with live inventory validation', async () => {
      const getCartRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${customerAToken}`)

      const gheeItem = getCartRes.body.items.find((i: any) => i.productId === activeProductId)
      expect(gheeItem).toBeDefined()

      // Update quantity from 2 to 3
      const patchRes = await request(app)
        .patch(`/api/v1/cart/items/${gheeItem.id}`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ quantity: 3 })

      expect(patchRes.status).toBe(200)
      const updatedGhee = patchRes.body.items.find((i: any) => i.productId === activeProductId)
      expect(updatedGhee.quantity).toBe(3)
      expect(updatedGhee.lineTotal).toBe(600)
    })

    it('DELETE /api/v1/cart/items/:itemId should remove single item from cart', async () => {
      const getCartRes = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${customerAToken}`)

      const saffronItem = getCartRes.body.items.find((i: any) => i.productId === highPricedProductId)

      const delRes = await request(app)
        .delete(`/api/v1/cart/items/${saffronItem.id}`)
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(delRes.status).toBe(200)
      expect(delRes.body.items.some((i: any) => i.productId === highPricedProductId)).toBe(false)
      // Only ghee remains (3 * 200 = 600)
      expect(delRes.body.subtotal).toBe(600)
    })

    // Strict Cross-Customer Cart Isolation
    it('Customer B should NOT be able to modify or delete Customer A cart items', async () => {
      const getCartA = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${customerAToken}`)

      const itemA = getCartA.body.items[0]
      expect(itemA).toBeDefined()

      // Customer B attempts to modify Customer A's line item
      const tamperRes = await request(app)
        .patch(`/api/v1/cart/items/${itemA.id}`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ quantity: 1 })

      expect([403, 404]).toContain(tamperRes.status)

      // Customer B attempts to delete Customer A's line item
      const delTamperRes = await request(app)
        .delete(`/api/v1/cart/items/${itemA.id}`)
        .set('Authorization', `Bearer ${customerBToken}`)

      expect([403, 404]).toContain(delTamperRes.status)
    })

    it('POST /api/v1/cart/validate should detect when cart items are valid and in stock', async () => {
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.isValid).toBe(true)
      expect(res.body.issues.length).toBe(0)
    })

    it('DELETE /api/v1/cart should empty the entire customer cart', async () => {
      const res = await request(app)
        .delete('/api/v1/cart')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.itemCount).toBe(0)
      expect(res.body.items.length).toBe(0)
      expect(res.body.subtotal).toBe(0)
      expect(res.body.total).toBe(0)
    })

    it('POST /api/v1/cart/items should support concurrent additions without duplicate rows', async () => {
      // Execute 3 concurrent requests adding 1 unit of highPricedProductId
      const concurrentRequests = [
        request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${customerBToken}`).send({ productId: highPricedProductId, quantity: 1 }),
        request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${customerBToken}`).send({ productId: highPricedProductId, quantity: 1 }),
        request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${customerBToken}`).send({ productId: highPricedProductId, quantity: 1 }),
      ]

      const results = await Promise.all(concurrentRequests)
      results.forEach((r) => expect(r.status).toBe(200))

      // Check final state for customer B
      const cartB = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${customerBToken}`)

      expect(cartB.status).toBe(200)
      // Exactly 1 line item for highPricedProductId with accumulated quantity of 3
      expect(cartB.body.items.length).toBe(1)
      expect(cartB.body.items[0].productId).toBe(highPricedProductId)
      expect(cartB.body.items[0].quantity).toBe(3)
    })

    it('Guest cart session should merge into customer account cart on login / merge', async () => {
      const guestSession = `guest-session-${timestamp}`

      // Guest adds 1 unit of activeProductId
      const guestAdd = await request(app)
        .post('/api/v1/cart/items')
        .set('x-session-token', guestSession)
        .send({ productId: activeProductId, quantity: 1 })

      expect(guestAdd.status).toBe(200)
      expect(guestAdd.body.sessionToken).toBe(guestSession)

      // Merge into Customer B cart (which currently has 3 units of highPricedProductId)
      const mergeRes = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ sessionToken: guestSession })

      expect(mergeRes.status).toBe(200)
      // Customer B should now have both products
      expect(mergeRes.body.items.length).toBe(2)
      expect(mergeRes.body.items.some((i: any) => i.productId === activeProductId)).toBe(true)
      expect(mergeRes.body.items.some((i: any) => i.productId === highPricedProductId)).toBe(true)
    })
  })
})
