import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { InventoryService } from '../../src/services/inventory.service'
import { __setCacheClientForTests, __resetCacheForTests } from '../../src/utils/cache'
import {
  PRODUCT_LIST_CACHE_PREFIX,
  PRODUCT_DETAIL_CACHE_PREFIX,
  CATEGORY_LIST_CACHE_PREFIX,
  CATEGORY_DETAIL_CACHE_PREFIX,
} from '../../src/utils/catalog-cache'

const ts = Date.now()

/**
 * Verifies that inventory mutations invalidate the public catalogue cache so an
 * admin stock change is visible on the next storefront GET instead of being
 * served stale for the remainder of the detail TTL. A fake Redis client records
 * the SCAN/DEL calls; the real client is restored afterwards.
 */
describe('Inventory — public catalogue cache invalidation', () => {
  type Call = { op: string; args: unknown[] }
  const calls: Call[] = []

  const fakeClient = {
    get: async (...args: unknown[]) => {
      calls.push({ op: 'get', args })
      return null
    },
    set: async (...args: unknown[]) => {
      calls.push({ op: 'set', args })
      return 'OK'
    },
    del: async (...args: unknown[]) => {
      calls.push({ op: 'del', args })
      return 1
    },
    scan: async (...args: unknown[]) => {
      calls.push({ op: 'scan', args })
      return { cursor: 0, keys: [] }
    },
  }

  let categoryId = ''
  let productId = ''
  let inventoryId = ''
  let adminId = ''

  const scannedPatterns = () =>
    calls
      .filter((c) => c.op === 'scan')
      .map((c) => String((c.args[1] as { MATCH?: string })?.MATCH ?? ''))

  beforeAll(async () => {
    const admin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminId = admin.user.id

    const category = await prisma.category.create({
      data: { name: `Inventory Cache ${ts}`, slug: `inventory-cache-${ts}` },
    })
    categoryId = category.id

    const product = await prisma.product.create({
      data: {
        name: `Inventory Cache Product ${ts}`,
        slug: `inv-cache-${ts}`,
        sku: `SKU-ICACHE-${ts}`,
        price: 100,
        mrp: 120,
        stock: 10,
        categoryId,
        isActive: true,
        status: 'PUBLISHED',
        inventory: { create: { availableQuantity: 10 } },
      },
      include: { inventory: true },
    })
    productId = product.id
    inventoryId = product.inventory!.id

    __setCacheClientForTests(fakeClient as any)
  }, 60000)

  afterAll(async () => {
    __resetCacheForTests()
    if (inventoryId) {
      await prisma.auditLog.deleteMany({ where: { entity: 'Inventory', entityId: inventoryId } })
    }
    if (productId) {
      await prisma.inventoryLog.deleteMany({ where: { productId } })
      await prisma.inventory.deleteMany({ where: { productId } })
      await prisma.product.deleteMany({ where: { id: productId } })
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } })
    }
  }, 60000)

  it('adjustStock invalidates every public catalogue key prefix', async () => {
    calls.length = 0

    await InventoryService.adjustStock(
      productId,
      { operation: 'ADD_STOCK', quantity: 5, reason: 'cache invalidation test' },
      adminId
    )

    const patterns = scannedPatterns()
    expect(patterns).toContain(`${PRODUCT_DETAIL_CACHE_PREFIX}*`)
    expect(patterns).toContain(`${PRODUCT_LIST_CACHE_PREFIX}*`)
    expect(patterns).toContain(`${CATEGORY_LIST_CACHE_PREFIX}*`)
    expect(patterns).toContain(`${CATEGORY_DETAIL_CACHE_PREFIX}*`)
  })

  it('updateInventorySettings invalidates the public catalogue cache', async () => {
    calls.length = 0

    await InventoryService.updateInventorySettings(
      productId,
      { reorderThreshold: 15 },
      adminId
    )

    const patterns = scannedPatterns()
    expect(patterns).toContain(`${PRODUCT_DETAIL_CACHE_PREFIX}*`)
    expect(patterns).toContain(`${PRODUCT_LIST_CACHE_PREFIX}*`)
  })
})
