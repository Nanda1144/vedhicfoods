import './_safety'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { InventoryService } from '../../src/services/inventory.service'

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const track = {
  userIds: [] as string[],
  categoryIds: [] as string[],
  productIds: [] as string[],
  orderIds: [] as string[],
  invoiceIds: [] as string[],
  paymentIds: [] as string[],
}

async function createOrder(userId: string, orderNumber: string) {
  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId,
      customerName: 'DB integrity fixture',
      customerEmail: `integrity-${stamp}@example.test`,
      phone: '9999999999',
      subtotal: 100,
      total: 100,
    },
  })
  track.orderIds.push(order.id)
  return order
}

async function createPayment(orderId: string, amount: number) {
  const payment = await prisma.payment.create({ data: { orderId, amount } })
  track.paymentIds.push(payment.id)
  return payment
}

async function createProduct(categoryId: string, overrides: Record<string, unknown> = {}) {
  const product = await prisma.product.create({
    data: {
      name: `DB integrity ${stamp}`,
      slug: `db-integrity-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
      categoryId,
      price: 100,
      mrp: 120,
      sku: `DBI-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
      ...overrides,
    } as any,
  })
  track.productIds.push(product.id)
  return product
}

/** Flattens an error and its `cause` chain into searchable text. */
function collectErrorText(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      parts.push(current.message)
      const meta = (current as { meta?: unknown }).meta
      if (meta) parts.push(JSON.stringify(meta))
    } else {
      parts.push(String(current))
    }
    current = (current as { cause?: unknown }).cause
  }
  return parts.join('\n')
}

/**
 * Asserts the database itself rejected the write via a CHECK constraint.
 *
 * Prisma surfaces a raw PostgreSQL CHECK violation (SQLSTATE `23514`) as
 * `PrismaClientUnknownRequestError`, not the modelled `P2004`, so the SQLSTATE
 * and constraint name arrive inside the message rather than `error.code`.
 * Accept either shape, but still require the named constraint so this fails if
 * the constraint is ever dropped.
 */
async function expectCheckConstraintFailure(
  operation: Promise<unknown>,
  constraint: string,
  assertNoRow?: () => Promise<unknown>,
) {
  let error: unknown
  let resolved = false
  try {
    await operation
    resolved = true
  } catch (caught) {
    error = caught
  }
  expect(resolved, `expected check constraint ${constraint} to reject the row, but the write succeeded`).toBe(false)

  const code = (error as { code?: string } | undefined)?.code
  const haystack = collectErrorText(error)
  expect(
    code === 'P2004' || haystack.includes('23514'),
    `expected a check violation (P2004 or SQLSTATE 23514) for ${constraint}, got: ${haystack}`,
  ).toBe(true)
  expect(haystack).toContain(constraint)

  if (assertNoRow) {
    expect(await assertNoRow(), `expected no row to persist after ${constraint} rejected the write`).toBeFalsy()
  }
}

describe('PostgreSQL security and integrity boundaries', () => {
  let userId: string
  let categoryId: string
  let productId: string
  let orderAId: string
  let orderBId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `db-integrity-${stamp}@example.test`,
        fullName: 'DB Integrity Fixture',
        passwordHash: await AuthService.hashPassword('FixturePassword@2026'),
        role: 'CUSTOMER',
      },
    })
    userId = user.id
    track.userIds.push(user.id)
    expect(user.passwordHash).not.toBe('FixturePassword@2026')

    const category = await prisma.category.create({
      data: { name: `DB Integrity ${stamp}`, slug: `db-integrity-${stamp}` },
    })
    categoryId = category.id
    track.categoryIds.push(category.id)

    const product = await createProduct(categoryId)
    productId = product.id
    const orderA = await createOrder(userId, `DBI-A-${stamp}`)
    const orderB = await createOrder(userId, `DBI-B-${stamp}`)
    orderAId = orderA.id
    orderBId = orderB.id
  }, 60000)

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: track.invoiceIds } } })
    await prisma.payment.deleteMany({ where: { id: { in: track.paymentIds } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: track.orderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: track.orderIds } } })
    await prisma.inventoryLog.deleteMany({ where: { productId: { in: track.productIds } } })
    await prisma.inventory.deleteMany({ where: { productId: { in: track.productIds } } })
    await prisma.product.deleteMany({ where: { id: { in: track.productIds } } })
    await prisma.category.deleteMany({ where: { id: { in: track.categoryIds } } })
    await prisma.user.deleteMany({ where: { id: { in: track.userIds } } })
  }, 60000)

  it('stores password hashes instead of plaintext passwords', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.passwordHash).not.toBe('FixturePassword@2026')
    expect(await AuthService.verifyPassword('FixturePassword@2026', user.passwordHash)).toBe(true)
  })

  it('enforces duplicate order numbers, invoice numbers, and SKUs in PostgreSQL', async () => {
    await expect(createOrder(userId, `DBI-A-${stamp}`)).rejects.toMatchObject({ code: 'P2002' })

    const invoiceNumber = `DBI-INV-${stamp}`
    const firstInvoice = await prisma.invoice.create({
      data: { invoiceNumber, orderId: orderAId, userId, subtotal: 100, total: 100 },
    })
    track.invoiceIds.push(firstInvoice.id)
    const duplicateInvoice = prisma.invoice.create({
      data: { invoiceNumber, orderId: orderBId, userId, subtotal: 100, total: 100 },
    }).then((invoice) => {
      track.invoiceIds.push(invoice.id)
      return invoice
    })
    await expect(duplicateInvoice).rejects.toMatchObject({ code: 'P2002' })

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
    await expect(createProduct(categoryId, {
      sku: product.sku,
      slug: `duplicate-sku-${stamp}`,
    })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rejects invalid user, product, and order relations at the database boundary', async () => {
    await expect(createOrder(`missing-user-${stamp}`, `DBI-BAD-USER-${stamp}`)).rejects.toMatchObject({ code: 'P2003' })

    await expect(prisma.orderItem.create({
      data: {
        orderId: orderAId,
        productId: `missing-product-${stamp}`,
        name: 'Invalid relation fixture',
        price: 1,
        quantity: 1,
        subtotal: 1,
      },
    })).rejects.toMatchObject({ code: 'P2003' })

    await expect(createPayment(`missing-order-${stamp}`, 1)).rejects.toMatchObject({ code: 'P2003' })
  })

  it('applies expected cascade behavior to product and order dependents', async () => {
    const product = await createProduct(categoryId)
    await prisma.inventory.create({ data: { productId: product.id, availableQuantity: 3 } })
    const image = await prisma.productImage.create({
      data: { productId: product.id, imageUrl: `https://cdn.example.test/${stamp}/image.webp` },
    })
    await prisma.inventoryLog.create({
      data: {
        inventoryId: (await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } })).id,
        productId: product.id,
        operation: 'TEST_CASCADE',
        previousQuantity: 0,
        newQuantity: 3,
        quantityChange: 3,
      },
    })

    await prisma.product.delete({ where: { id: product.id } })
    expect(await prisma.productImage.findUnique({ where: { id: image.id } })).toBeNull()
    expect(await prisma.inventory.findUnique({ where: { productId: product.id } })).toBeNull()
    expect(await prisma.inventoryLog.findMany({ where: { productId: product.id } })).toHaveLength(0)

    const order = await createOrder(userId, `DBI-CASCADE-${stamp}`)
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId,
        name: 'Cascade fixture item',
        price: 100,
        quantity: 1,
        subtotal: 100,
      },
    })
    await prisma.order.delete({ where: { id: order.id } })
    expect(await prisma.orderItem.findUnique({ where: { id: item.id } })).toBeNull()
  })

  it('rejects negative price, stock, inventory quantity, and payment amount in PostgreSQL', async () => {
    const negativePriceSku = `DBI-NEG-PRICE-${stamp}`
    await expectCheckConstraintFailure(
      createProduct(categoryId, { price: -1, sku: negativePriceSku, slug: `db-integrity-neg-price-${stamp}` }),
      'products_price_nonnegative_check',
      () => prisma.product.findUnique({ where: { sku: negativePriceSku } }),
    )

    const negativeStockSku = `DBI-NEG-STOCK-${stamp}`
    await expectCheckConstraintFailure(
      createProduct(categoryId, { stock: -1, sku: negativeStockSku, slug: `db-integrity-neg-stock-${stamp}` }),
      'products_stock_nonnegative_check',
      () => prisma.product.findUnique({ where: { sku: negativeStockSku } }),
    )

    await expectCheckConstraintFailure(prisma.inventory.create({
      data: { productId, availableQuantity: -1 },
    }), 'inventories_availableQuantity_nonnegative_check', () => prisma.inventory.findUnique({ where: { productId } }))

    await expectCheckConstraintFailure(createPayment(orderBId, -1), 'payments_amount_nonnegative_check', () => prisma.payment.findFirst({ where: { orderId: orderBId } }))
  })

  it('rolls back all writes in a failed transaction', async () => {
    const number = `DBI-ROLLBACK-${stamp}`
    await expect(prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          orderNumber: number,
          userId,
          customerName: 'Rollback fixture',
          customerEmail: `rollback-${stamp}@example.test`,
          phone: '9999999999',
          subtotal: 100,
          total: 100,
        },
      })
      await tx.payment.create({ data: { orderId: `missing-${stamp}`, amount: 1 } })
    })).rejects.toMatchObject({ code: 'P2003' })

    expect(await prisma.order.findUnique({ where: { orderNumber: number } })).toBeNull()
  })

  it('serializes concurrent inventory adjustments without losing increments', async () => {
    await prisma.inventory.create({
      data: { productId, availableQuantity: 0, reservedQuantity: 0, soldQuantity: 0 },
    })

    await Promise.all(Array.from({ length: 10 }, () => InventoryService.adjustStock(productId, {
      operation: 'ADD_STOCK',
      quantity: 1,
      reason: 'Concurrent integrity test',
    })))

    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId } })
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
    const logCount = await prisma.inventoryLog.count({ where: { productId, reason: 'Concurrent integrity test' } })
    expect(inventory.availableQuantity).toBe(10)
    expect(product.stock).toBe(10)
    expect(logCount).toBe(10)
  })
})
