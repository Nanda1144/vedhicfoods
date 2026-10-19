import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  InventoryStatus,
} from '@prisma/client'
import { prisma } from '../../src/config/database'
import { ensureDemoCustomer } from './helpers/demo-user'
import { ReservationSweepService } from '../../src/services/reservation-sweep.service'

const ts = Date.now()

/**
 * Stale-reservation reaper.
 *
 * A Razorpay checkout that is abandoned after `reserveStock` moves units from
 * available to reserved leaves the order in PENDING_PAYMENT forever; nothing
 * else releases those units. These cases pin the two guarantees that matter:
 * stale orders are cancelled *and* their stock is returned, while fresh orders
 * and repeat sweeps are untouched.
 */
describe('Reservation sweep — expire abandoned checkouts', () => {
  let userId: string

  interface Fixture {
    categoryId: string
    productId: string
    inventoryId: string
  }

  const fixtures: Fixture[] = []
  const orderIds: string[] = []

  const buildFixture = async (label: string): Promise<Fixture> => {
    const category = await prisma.category.create({
      data: { name: `Sweep ${label} ${ts}`, slug: `sweep-${label}-${ts}`.toLowerCase() },
    })
    const product = await prisma.product.create({
      data: {
        name: `Sweep Product ${label} ${ts}`,
        slug: `sweep-product-${label}-${ts}`.toLowerCase(),
        sku: `SWEEP-${label}-${ts}`.toUpperCase(),
        price: 100,
        mrp: 120,
        unit: 'piece',
        stock: 6,
        categoryId: category.id,
        isActive: true,
        status: 'PUBLISHED',
        isDeleted: false,
        inventory: {
          create: {
            availableQuantity: 6,
            reservedQuantity: 4,
            soldQuantity: 0,
            reorderThreshold: 2,
            status: InventoryStatus.IN_STOCK,
          },
        },
      },
      include: { inventory: true },
    })

    const fixture: Fixture = {
      categoryId: category.id,
      productId: product.id,
      inventoryId: product.inventory!.id,
    }
    fixtures.push(fixture)
    return fixture
  }

  const createOrder = async (fixture: Fixture, number: string, createdAt: Date) => {
    const order = await prisma.order.create({
      data: {
        orderNumber: number,
        userId,
        customerName: 'Sweep Test',
        customerEmail: 'sweep@example.com',
        phone: '9000000999',
        subtotal: 400,
        total: 400,
        status: OrderStatus.PENDING_PAYMENT,
        paymentStatus: PaymentStatus.PENDING,
        paymentMethod: PaymentMethod.RAZORPAY,
        createdAt,
        items: {
          create: [
            {
              productId: fixture.productId,
              name: `Sweep Product ${ts}`,
              sku: `SWEEP-${ts}`,
              price: 100,
              quantity: 4,
              subtotal: 400,
            },
          ],
        },
      },
    })
    orderIds.push(order.id)
    return order
  }

  beforeAll(async () => {
    const customer = await ensureDemoCustomer()
    userId = customer.id
  })

  afterAll(async () => {
    await prisma.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    for (const fixture of fixtures) {
      await prisma.product.deleteMany({ where: { id: fixture.productId } })
      await prisma.category.deleteMany({ where: { id: fixture.categoryId } })
    }
  })

  it('cancels a stale PENDING_PAYMENT order and returns its reserved units', async () => {
    const fixture = await buildFixture('stale')
    const order = await createOrder(
      fixture,
      `SWEEP-STALE-${ts}`,
      new Date(Date.now() - 31 * 60 * 1000)
    )

    const result = await ReservationSweepService.runOnce()

    expect(result.reaped).toBeGreaterThanOrEqual(1)
    const row = await prisma.order.findUnique({ where: { id: order.id } })
    expect(row?.status).toBe(OrderStatus.CANCELLED)

    const inventory = await prisma.inventory.findUnique({ where: { id: fixture.inventoryId } })
    expect(inventory?.availableQuantity).toBe(10)
    expect(inventory?.reservedQuantity).toBe(0)
  })

  it('leaves a fresh PENDING_PAYMENT order and its reservation untouched', async () => {
    const fixture = await buildFixture('fresh')
    const order = await createOrder(fixture, `SWEEP-FRESH-${ts}`, new Date())

    await ReservationSweepService.runOnce()

    const row = await prisma.order.findUnique({ where: { id: order.id } })
    expect(row?.status).toBe(OrderStatus.PENDING_PAYMENT)

    const inventory = await prisma.inventory.findUnique({ where: { id: fixture.inventoryId } })
    expect(inventory?.availableQuantity).toBe(6)
    expect(inventory?.reservedQuantity).toBe(4)
  })

  it('is idempotent: repeated sweeps never release the same order twice', async () => {
    const fixture = await buildFixture('idem')
    await createOrder(fixture, `SWEEP-IDEM-${ts}`, new Date(Date.now() - 31 * 60 * 1000))

    await ReservationSweepService.runOnce()
    await ReservationSweepService.runOnce()
    await ReservationSweepService.runOnce()

    const inventory = await prisma.inventory.findUnique({ where: { id: fixture.inventoryId } })
    expect(inventory?.availableQuantity).toBe(10)
    expect(inventory?.reservedQuantity).toBe(0)
  })
})
