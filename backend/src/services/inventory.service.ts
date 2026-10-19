import { Request } from 'express'
import { Prisma, InventoryStatus } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { invalidateCatalogCaches } from '../utils/catalog-cache'
import { BadRequestError, NotFoundError } from '../utils/errors'
import {
  AdjustStockInput,
  UpdateInventoryInput,
  InventoryQueryInput,
  ReservationItem,
  FormattedInventory,
  FormattedInventoryLog,
  INVENTORY_AUDIT_ACTIONS,
  MAX_INVENTORY_QUANTITY,
} from '../types/inventory.types'

export class InventoryService {
  /**
   * Safe status computation based on authoritative stock numbers.
   */
  public static computeStatus(
    available: number,
    threshold: number,
    forcedStatus?: InventoryStatus | null
  ): InventoryStatus {
    if (forcedStatus === InventoryStatus.BACKORDER) {
      return InventoryStatus.BACKORDER
    }
    if (available <= 0) {
      return InventoryStatus.OUT_OF_STOCK
    }
    if (available <= threshold) {
      return InventoryStatus.LOW_STOCK
    }
    return InventoryStatus.IN_STOCK
  }

  /**
   * Formats inventory record for API response.
   */
  public static formatInventory(inv: any): FormattedInventory {
    const availableQuantity = Number(inv.availableQuantity || 0)
    const reservedQuantity = Number(inv.reservedQuantity || 0)
    const soldQuantity = Number(inv.soldQuantity || 0)
    const reorderThreshold = Number(inv.reorderThreshold || 10)
    const totalStock = availableQuantity + reservedQuantity

    const isLowStock = availableQuantity > 0 && availableQuantity <= reorderThreshold
    const isOutOfStock = availableQuantity <= 0

    const product = inv.product
    const primaryImg = product?.images?.find((img: any) => img.isPrimary)?.imageUrl ||
      product?.images?.[0]?.imageUrl ||
      undefined

    return {
      id: inv.id,
      productId: inv.productId,
      sku: product?.sku || '',
      productName: product?.name || '',
      slug: product?.slug || '',
      categoryName: product?.category?.name || null,
      price: product ? Number(product.price) : 0,
      availableQuantity,
      reservedQuantity,
      totalStock,
      soldQuantity,
      reorderThreshold,
      status: inv.status,
      isLowStock,
      isOutOfStock,
      updatedAt: inv.updatedAt instanceof Date ? inv.updatedAt.toISOString() : new Date().toISOString(),
      product: product
        ? {
            id: product.id,
            name: product.name,
            slug: product.slug,
            sku: product.sku,
            price: Number(product.price),
            stock: Number(product.stock),
            isActive: Boolean(product.isActive),
            status: product.status,
            primaryImage: primaryImg,
          }
        : undefined,
    }
  }

  /**
   * Formats inventory log record for API response.
   */
  public static formatInventoryLog(log: any): FormattedInventoryLog {
    return {
      id: log.id,
      inventoryId: log.inventoryId,
      productId: log.productId,
      productName: log.product?.name,
      sku: log.product?.sku,
      actorId: log.actorId,
      actorEmail: log.actorEmail || log.actor?.email || null,
      operation: log.operation,
      previousQuantity: log.previousQuantity,
      newQuantity: log.newQuantity,
      quantityChange: log.quantityChange,
      previousReserved: log.previousReserved,
      newReserved: log.newReserved,
      reason: log.reason,
      orderId: log.orderId,
      metadata: (log.metadata as Record<string, any>) || {},
      createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : new Date().toISOString(),
    }
  }

  /**
   * Resolves product and ensures an inventory record exists (Self-Healing).
   */
  public static async getOrCreateInventory(
    tx: Prisma.TransactionClient,
    productIdOrSlug: string
  ) {
    const product = await tx.product.findFirst({
      where: {
        OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
      },
      include: {
        inventory: true,
        category: true,
        images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
      },
    })

    if (!product) {
      throw new NotFoundError(`Product '${productIdOrSlug}' not found`)
    }

    if (product.inventory) {
      return { product, inventory: product.inventory }
    }

    // Self-heal: create missing inventory record linked to product
    const initialStock = Number(product.stock || 0)
    const initialStatus = this.computeStatus(initialStock, 10)

    const inventory = await tx.inventory.create({
      data: {
        productId: product.id,
        availableQuantity: initialStock,
        reservedQuantity: 0,
        soldQuantity: 0,
        reorderThreshold: 10,
        status: initialStatus,
      },
    })

    return { product, inventory }
  }

  /**
   * GET /api/v1/admin/inventory
   * List inventory with filtering, searching, low stock detection, and pagination.
   */
  public static async listInventory(query: InventoryQueryInput) {
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.per_page ?? query.limit ?? 20))
    const search = (query.search || query.q)?.trim()
    const isLowStock = query.lowStockOnly || (query as any).low_stock
    const statusFilter = query.status

    const where: Prisma.InventoryWhereInput = {
      product: {
        isDeleted: false,
      },
    }

    const productWhere: Prisma.ProductWhereInput = {
      isDeleted: false,
    }

    if (search) {
      productWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (query.categoryId) {
      productWhere.categoryId = query.categoryId
    }

    where.product = productWhere

    if (statusFilter && statusFilter !== 'ALL') {
      where.status = statusFilter
    }

    let records: any[] = []
    let total = 0

    if (isLowStock) {
      // Find items where availableQuantity <= reorderThreshold OR status is LOW_STOCK / OUT_OF_STOCK
      const allInventories = await prisma.inventory.findMany({
        where,
        include: {
          product: {
            include: {
              category: true,
              images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
            },
          },
        },
        orderBy: [{ availableQuantity: 'asc' }, { updatedAt: 'desc' }],
      })

      const filtered = allInventories.filter(
        (inv) => inv.availableQuantity <= inv.reorderThreshold || inv.status === InventoryStatus.LOW_STOCK || inv.status === InventoryStatus.OUT_OF_STOCK
      )

      total = filtered.length
      records = filtered.slice((page - 1) * limit, page * limit)
    } else {
      total = await prisma.inventory.count({ where })
      records = await prisma.inventory.findMany({
        where,
        include: {
          product: {
            include: {
              category: true,
              images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      })
    }

    const items = records.map((r) => this.formatInventory(r))

    return {
      items,
      page,
      limit,
      per_page: limit,
      total,
      totalPages: Math.ceil(total / limit),
      total_pages: Math.ceil(total / limit),
    }
  }

  /**
   * GET /api/v1/admin/inventory/:productId
   * Fetch single product's inventory details.
   */
  public static async getInventoryByProductId(productIdOrSlug: string): Promise<FormattedInventory> {
    const { inventory, product } = await prisma.$transaction(async (tx) => {
      return this.getOrCreateInventory(tx, productIdOrSlug)
    })

    return this.formatInventory({ ...inventory, product })
  }

  /**
   * PATCH /api/v1/admin/inventory/:productId
   * Update configurable low-stock threshold, forced status, or notes.
   */
  public static async updateInventorySettings(
    productIdOrSlug: string,
    data: UpdateInventoryInput,
    actorId?: string,
    req?: Request
  ): Promise<FormattedInventory> {
    const result = await prisma.$transaction(async (tx) => {
      const { product, inventory } = await this.getOrCreateInventory(tx, productIdOrSlug)

      const newThreshold = data.reorderThreshold !== undefined ? data.reorderThreshold : inventory.reorderThreshold
      const calculatedStatus = this.computeStatus(
        inventory.availableQuantity,
        newThreshold,
        data.status !== undefined ? data.status : inventory.status
      )

      const updated = await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          reorderThreshold: newThreshold,
          status: calculatedStatus,
        },
        include: {
          product: {
            include: {
              category: true,
              images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
            },
          },
        },
      })

      // Record adjustment log
      await tx.inventoryLog.create({
        data: {
          inventoryId: updated.id,
          productId: product.id,
          actorId: actorId || null,
          actorEmail: req?.user?.email || null,
          operation: 'MANUAL_ADJUSTMENT',
          previousQuantity: inventory.availableQuantity,
          newQuantity: updated.availableQuantity,
          quantityChange: 0,
          previousReserved: inventory.reservedQuantity,
          newReserved: updated.reservedQuantity,
          reason: data.notes || `Reorder threshold updated to ${newThreshold}`,
          metadata: {
            oldThreshold: inventory.reorderThreshold,
            newThreshold,
            oldStatus: inventory.status,
            newStatus: calculatedStatus,
          },
        },
      })

      return updated
    })

    await AuditService.record({
      action: INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED,
      entity: 'Inventory',
      entityId: result.id,
      actorId,
      metadata: {
        productId: result.productId,
        productName: result.product.name,
        reorderThreshold: result.reorderThreshold,
        status: result.status,
      },
      req,
    })

    // Threshold / status changes flow into the public availability label.
    await invalidateCatalogCaches()

    return this.formatInventory(result)
  }

  /**
   * POST /api/v1/admin/inventory/:productId/adjust
   * Administrative manual stock adjustment (ADD, REMOVE, RESTOCK, MANUAL).
   */
  public static async adjustStock(
    productIdOrSlug: string,
    input: AdjustStockInput,
    actorId?: string,
    req?: Request
  ): Promise<FormattedInventory> {
    const { operation, quantity, reason, reorderThreshold } = input

    if (!quantity || quantity <= 0) {
      throw new BadRequestError('Adjustment quantity must be greater than zero')
    }

    const { result, previousAvailable } = await prisma.$transaction(async (tx) => {
      const { product, inventory } = await this.getOrCreateInventory(tx, productIdOrSlug)

      const lockedRows: any[] = await tx.$queryRaw`SELECT id, "availableQuantity", "reservedQuantity", "soldQuantity" FROM inventories WHERE id = ${inventory.id} FOR UPDATE`
      const prevAvailable = lockedRows.length > 0 ? Number(lockedRows[0].availableQuantity) : inventory.availableQuantity
      const prevReserved = lockedRows.length > 0 ? Number(lockedRows[0].reservedQuantity) : inventory.reservedQuantity
      const prevSold = lockedRows.length > 0 ? Number(lockedRows[0].soldQuantity) : inventory.soldQuantity
      let newAvailable = prevAvailable
      let newSold = prevSold
      let quantityChange = 0

      switch (operation) {
        case 'ADD_STOCK':
        case 'RESTOCK':
          quantityChange = quantity
          newAvailable = prevAvailable + quantity
          if (operation === 'RESTOCK' && prevSold >= quantity) {
            newSold = prevSold - quantity
          }
          break

        case 'REMOVE_STOCK':
          if (prevAvailable < quantity) {
            throw new BadRequestError(
              `Cannot remove ${quantity} items. Only ${prevAvailable} items currently available.`
            )
          }
          quantityChange = -quantity
          newAvailable = prevAvailable - quantity
          break

        case 'MANUAL_ADJUSTMENT':
          // For manual adjustment, quantity represents the new absolute available stock target
          quantityChange = quantity - prevAvailable
          newAvailable = quantity
          break

        default:
          throw new BadRequestError(`Invalid manual adjustment operation: ${operation}`)
      }

      if (newAvailable < 0) {
        throw new BadRequestError('Operation would result in negative available inventory')
      }

      // `inventories.availableQuantity` is a 4-byte signed integer. A large
      // ADD_STOCK/RESTOCK (or MANUAL_ADJUSTMENT target) that passes the schema
      // bound can still overflow when added to the current quantity; reject it
      // as a validation error rather than letting the write fail as a 500.
      if (!Number.isSafeInteger(newAvailable) || newAvailable > MAX_INVENTORY_QUANTITY) {
        throw new BadRequestError('Operation would exceed the maximum supported inventory quantity')
      }

      const threshold = reorderThreshold !== undefined ? reorderThreshold : inventory.reorderThreshold
      const newStatus = this.computeStatus(newAvailable, threshold)

      // 1. Update Inventory Table
      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          availableQuantity: newAvailable,
          soldQuantity: newSold,
          reorderThreshold: threshold,
          status: newStatus,
        },
        include: {
          product: {
            include: {
              category: true,
              images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
            },
          },
        },
      })

      // 2. Keep Product.stock in sync with available stock
      await tx.product.update({
        where: { id: product.id },
        data: { stock: newAvailable },
      })

      // 3. Record Inventory Movement Log
      await tx.inventoryLog.create({
        data: {
          inventoryId: inventory.id,
          productId: product.id,
          actorId: actorId || null,
          actorEmail: req?.user?.email || null,
          operation,
          previousQuantity: prevAvailable,
          newQuantity: newAvailable,
          quantityChange,
          previousReserved: prevReserved,
          newReserved: prevReserved,
          reason: reason || `Manual adjustment via ${operation}`,
          metadata: {
            threshold,
            status: newStatus,
          },
        },
      })

      return { result: updatedInventory, previousAvailable: prevAvailable }
    }, { maxWait: 10_000, timeout: 30_000 })

    const auditAction =
      operation === 'RESTOCK'
        ? INVENTORY_AUDIT_ACTIONS.STOCK_RESTOCKED
        : INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED

    await AuditService.record({
      action: auditAction,
      entity: 'Inventory',
      entityId: result.id,
      actorId,
      metadata: {
        productId: result.productId,
        productName: result.product.name,
        operation,
        quantity,
        previousQuantity: previousAvailable,
        newQuantity: result.availableQuantity,
        reason,
      },
      req,
    })

    // Admin stock changes alter the public product's stock / availability, so
    // drop the cached storefront reads or the next GET can serve stale stock
    // for the remainder of the detail TTL. No-op when Redis is not configured.
    await invalidateCatalogCaches()

    logger.info(
      {
        productId: result.productId,
        operation,
        newAvailable: result.availableQuantity,
        status: result.status,
      },
      'Inventory stock adjusted successfully'
    )

    return this.formatInventory(result)
  }

  /**
   * RESERVE STOCK
   * Atomically locks stock and reserves items for checkout/order placement.
   * Prevents overselling, race conditions, and negative inventory.
   * Deterministically sorts product IDs to prevent transaction deadlocks.
   */
  public static async reserveStock(
    items: ReservationItem[],
    context?: { orderId?: string; orderNumber?: string; actorId?: string; actorEmail?: string; reason?: string },
    externalTx?: Prisma.TransactionClient
  ): Promise<{ success: boolean; reservedItems: { productId: string; quantity: number }[] }> {
    if (!items || items.length === 0) {
      throw new BadRequestError('Cannot reserve empty stock items')
    }

    // Deterministic sort order prevents PostgreSQL deadlocks on concurrent transactions
    const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId))

    const executeReservation = async (tx: Prisma.TransactionClient) => {
      const reservedDetails: { productId: string; quantity: number }[] = []

      for (const item of sortedItems) {
        const qty = item.quantity
        if (qty <= 0) {
          throw new BadRequestError(`Invalid reservation quantity (${qty}) for item ${item.productId}`)
        }

        const { product, inventory } = await this.getOrCreateInventory(tx, item.productId)

        // Acquire exclusive row-level lock in PostgreSQL to serialize concurrent transactions
        const lockedRows: any[] = await tx.$queryRaw`SELECT id, "availableQuantity", "reservedQuantity" FROM inventories WHERE id = ${inventory.id} FOR UPDATE`
        const currentAvailable = lockedRows.length > 0 ? Number(lockedRows[0].availableQuantity) : inventory.availableQuantity
        const currentReserved = lockedRows.length > 0 ? Number(lockedRows[0].reservedQuantity) : inventory.reservedQuantity

        // Authoritative stock verification with serialized state
        if (currentAvailable < qty) {
          throw new BadRequestError(
            `Insufficient stock for '${product.name}'. Available: ${currentAvailable}, Requested: ${qty}`
          )
        }

        const prevAvailable = currentAvailable
        const prevReserved = currentReserved
        const newAvailable = prevAvailable - qty
        const newReserved = prevReserved + qty

        if (newAvailable < 0) {
          throw new BadRequestError(`Cannot reserve: Available quantity would become negative for '${product.name}'`)
        }

        const newStatus = this.computeStatus(newAvailable, inventory.reorderThreshold)

        // Atomic update with condition ensuring availableQuantity >= qty
        const updateResult = await tx.inventory.updateMany({
          where: {
            id: inventory.id,
            availableQuantity: { gte: qty },
          },
          data: {
            availableQuantity: { decrement: qty },
            reservedQuantity: { increment: qty },
            status: newStatus,
          },
        })

        if (updateResult.count === 0) {
          throw new BadRequestError(
            `Insufficient stock for '${product.name}'. Available stock is insufficient for requested quantity (${qty}).`
          )
        }

        // Sync Product.stock
        await tx.product.update({
          where: { id: product.id },
          data: { stock: newAvailable },
        })

        // Log movement
        await tx.inventoryLog.create({
          data: {
            inventoryId: inventory.id,
            productId: product.id,
            actorId: context?.actorId || null,
            actorEmail: context?.actorEmail || null,
            operation: 'RESERVE_STOCK',
            previousQuantity: prevAvailable,
            newQuantity: newAvailable,
            quantityChange: -qty,
            previousReserved: prevReserved,
            newReserved,
            reason: context?.reason || `Stock reserved for order ${context?.orderNumber || context?.orderId || ''}`.trim(),
            orderId: context?.orderId || null,
            metadata: {
              orderNumber: context?.orderNumber,
            },
          },
        })

        reservedDetails.push({ productId: product.id, quantity: qty })
      }

      return { success: true, reservedItems: reservedDetails }
    }

    const result = externalTx
      ? await executeReservation(externalTx)
      : await prisma.$transaction(executeReservation, { timeout: 20000, maxWait: 15000 })

    // Non-blocking audit trail
    AuditService.record({
      action: INVENTORY_AUDIT_ACTIONS.STOCK_RESERVED,
      entity: 'Order',
      entityId: context?.orderId || null,
      actorId: context?.actorId || null,
      actorEmail: context?.actorEmail || null,
      metadata: {
        orderNumber: context?.orderNumber,
        items: result.reservedItems,
      },
    }).catch((err) => logger.warn({ err: err.message }, 'Failed to record audit for reservation'))

    return result
  }

  /**
   * RELEASE RESERVATION
   * Releases previously held stock reservation back to available stock.
   * Called on checkout abandonment, payment failure, or order cancellation before capture.
   */
  public static async releaseReservation(
    items: ReservationItem[],
    context?: { orderId?: string; orderNumber?: string; actorId?: string; actorEmail?: string; reason?: string },
    externalTx?: Prisma.TransactionClient
  ): Promise<{ success: boolean; releasedItems: { productId: string; quantity: number }[] }> {
    if (!items || items.length === 0) return { success: true, releasedItems: [] }

    const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId))

    const executeRelease = async (tx: Prisma.TransactionClient) => {
      const releasedDetails: { productId: string; quantity: number }[] = []

      for (const item of sortedItems) {
        const qty = item.quantity
        if (qty <= 0) continue

        const { product, inventory } = await this.getOrCreateInventory(tx, item.productId)

        const lockedRows: any[] = await tx.$queryRaw`SELECT id, "availableQuantity", "reservedQuantity" FROM inventories WHERE id = ${inventory.id} FOR UPDATE`
        const prevAvailable = lockedRows.length > 0 ? Number(lockedRows[0].availableQuantity) : inventory.availableQuantity
        const prevReserved = lockedRows.length > 0 ? Number(lockedRows[0].reservedQuantity) : inventory.reservedQuantity

        // Release at most what was reserved
        const releaseQty = Math.min(prevReserved, qty)
        if (releaseQty <= 0) continue

        const newAvailable = prevAvailable + releaseQty
        const newReserved = Math.max(0, prevReserved - releaseQty)
        const newStatus = this.computeStatus(newAvailable, inventory.reorderThreshold)

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            availableQuantity: newAvailable,
            reservedQuantity: newReserved,
            status: newStatus,
          },
        })

        await tx.product.update({
          where: { id: product.id },
          data: { stock: newAvailable },
        })

        await tx.inventoryLog.create({
          data: {
            inventoryId: inventory.id,
            productId: product.id,
            actorId: context?.actorId || null,
            actorEmail: context?.actorEmail || null,
            operation: 'RELEASE_RESERVATION',
            previousQuantity: prevAvailable,
            newQuantity: newAvailable,
            quantityChange: releaseQty,
            previousReserved: prevReserved,
            newReserved,
            reason: context?.reason || `Reservation released for order ${context?.orderNumber || context?.orderId || ''}`.trim(),
            orderId: context?.orderId || null,
            metadata: {
              orderNumber: context?.orderNumber,
            },
          },
        })

        releasedDetails.push({ productId: product.id, quantity: releaseQty })
      }

      return { success: true, releasedItems: releasedDetails }
    }

    const result = externalTx
      ? await executeRelease(externalTx)
      : await prisma.$transaction(executeRelease, { timeout: 20000, maxWait: 15000 })

    AuditService.record({
      action: INVENTORY_AUDIT_ACTIONS.STOCK_RELEASED,
      entity: 'Order',
      entityId: context?.orderId || null,
      actorId: context?.actorId || null,
      actorEmail: context?.actorEmail || null,
      metadata: {
        orderNumber: context?.orderNumber,
        items: result.releasedItems,
        reason: context?.reason,
      },
    }).catch((err) => logger.warn({ err: err.message }, 'Failed to record audit for release'))

    return result
  }

  /**
   * CONFIRM DEDUCTION
   * Finalizes inventory deduction when payment is confirmed or COD order is fulfilled.
   * Decrements reservedQuantity and increments soldQuantity.
   */
  public static async confirmDeduction(
    items: ReservationItem[],
    context?: { orderId?: string; orderNumber?: string; actorId?: string; actorEmail?: string; reason?: string },
    externalTx?: Prisma.TransactionClient
  ): Promise<{ success: boolean; deductedItems: { productId: string; quantity: number }[] }> {
    if (!items || items.length === 0) return { success: true, deductedItems: [] }

    const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId))

    const executeDeduction = async (tx: Prisma.TransactionClient) => {
      const deductedDetails: { productId: string; quantity: number }[] = []

      for (const item of sortedItems) {
        const qty = item.quantity
        if (qty <= 0) continue

        const { product, inventory } = await this.getOrCreateInventory(tx, item.productId)

        const lockedRows: any[] = await tx.$queryRaw`SELECT id, "availableQuantity", "reservedQuantity", "soldQuantity" FROM inventories WHERE id = ${inventory.id} FOR UPDATE`
        const prevReserved = lockedRows.length > 0 ? Number(lockedRows[0].reservedQuantity) : inventory.reservedQuantity
        const prevSold = lockedRows.length > 0 ? Number(lockedRows[0].soldQuantity) : inventory.soldQuantity
        // Only the quantity actually taken out of the reservation may become
        // sold. Previously `newSold = prevSold + qty` incremented sold by the
        // full requested quantity even when the reservation was already drained,
        // so a second call (e.g. webhook racing client-side verification)
        // double-counted soldQuantity. `deductQty` is 0 once reserved hits 0,
        // which makes this primitive idempotent.
        const deductQty = Math.min(prevReserved, qty)

        const newReserved = Math.max(0, prevReserved - deductQty)
        const newSold = prevSold + deductQty

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            reservedQuantity: newReserved,
            soldQuantity: newSold,
          },
        })

        await tx.inventoryLog.create({
          data: {
            inventoryId: inventory.id,
            productId: product.id,
            actorId: context?.actorId || null,
            actorEmail: context?.actorEmail || null,
            operation: 'CONFIRM_DEDUCTION',
            previousQuantity: inventory.availableQuantity,
            newQuantity: inventory.availableQuantity,
            quantityChange: 0,
            previousReserved: prevReserved,
            newReserved,
            reason: context?.reason || `Payment confirmed for order ${context?.orderNumber || context?.orderId || ''}`.trim(),
            orderId: context?.orderId || null,
            metadata: {
              orderNumber: context?.orderNumber,
              soldIncrement: deductQty,
            },
          },
        })

        deductedDetails.push({ productId: product.id, quantity: deductQty })
      }

      return { success: true, deductedItems: deductedDetails }
    }

    const result = externalTx
      ? await executeDeduction(externalTx)
      : await prisma.$transaction(executeDeduction, { timeout: 20000, maxWait: 15000 })

    AuditService.record({
      action: INVENTORY_AUDIT_ACTIONS.STOCK_DEDUCTED,
      entity: 'Order',
      entityId: context?.orderId || null,
      actorId: context?.actorId || null,
      actorEmail: context?.actorEmail || null,
      metadata: {
        orderNumber: context?.orderNumber,
        items: result.deductedItems,
      },
    }).catch((err) => logger.warn({ err: err.message }, 'Failed to record audit for deduction'))

    return result
  }

  /**
   * RESTOCK ORDER
   * Restores inventory when an already-deducted order is cancelled or returned.
   * Increments availableQuantity, decrements soldQuantity, syncs Product.stock.
   */
  public static async restockOrder(
    items: ReservationItem[],
    context?: { orderId?: string; orderNumber?: string; actorId?: string; actorEmail?: string; reason?: string },
    externalTx?: Prisma.TransactionClient
  ): Promise<{ success: boolean; restockedItems: { productId: string; quantity: number }[] }> {
    if (!items || items.length === 0) return { success: true, restockedItems: [] }

    const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId))

    const executeRestock = async (tx: Prisma.TransactionClient) => {
      const restockedDetails: { productId: string; quantity: number }[] = []

      // Idempotency guard: an order's deducted stock may only be credited back
      // once. Several recovery paths can otherwise target the same order
      // (delivery RETURNED -> CANCELLED, then a late order-cancel), each of
      // which would inflate available stock. The RESTOCK movement log written by
      // the first successful restock is the durable marker of that fact.
      if (context?.orderId) {
        const existingRestock = await tx.inventoryLog.findFirst({
          where: { orderId: context.orderId, operation: 'RESTOCK' },
          select: { id: true },
        })
        if (existingRestock) {
          return { success: true, restockedItems: [] }
        }
      }

      for (const item of sortedItems) {
        const qty = item.quantity
        if (qty <= 0) continue

        const { product, inventory } = await this.getOrCreateInventory(tx, item.productId)

        const lockedRows: any[] = await tx.$queryRaw`SELECT id, "availableQuantity", "soldQuantity" FROM inventories WHERE id = ${inventory.id} FOR UPDATE`
        const prevAvailable = lockedRows.length > 0 ? Number(lockedRows[0].availableQuantity) : inventory.availableQuantity
        const prevSold = lockedRows.length > 0 ? Number(lockedRows[0].soldQuantity) : inventory.soldQuantity

        const newAvailable = prevAvailable + qty
        const newSold = Math.max(0, prevSold - qty)
        const newStatus = this.computeStatus(newAvailable, inventory.reorderThreshold)

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            availableQuantity: newAvailable,
            soldQuantity: newSold,
            status: newStatus,
          },
        })

        await tx.product.update({
          where: { id: product.id },
          data: { stock: newAvailable },
        })

        await tx.inventoryLog.create({
          data: {
            inventoryId: inventory.id,
            productId: product.id,
            actorId: context?.actorId || null,
            actorEmail: context?.actorEmail || null,
            operation: 'RESTOCK',
            previousQuantity: prevAvailable,
            newQuantity: newAvailable,
            quantityChange: qty,
            previousReserved: inventory.reservedQuantity,
            newReserved: inventory.reservedQuantity,
            reason: context?.reason || `Restocked after order cancellation (${context?.orderNumber || context?.orderId || ''})`.trim(),
            orderId: context?.orderId || null,
            metadata: {
              orderNumber: context?.orderNumber,
            },
          },
        })

        restockedDetails.push({ productId: product.id, quantity: qty })
      }

      return { success: true, restockedItems: restockedDetails }
    }

    const result = externalTx
      ? await executeRestock(externalTx)
      : await prisma.$transaction(executeRestock, { timeout: 20000, maxWait: 15000 })

    AuditService.record({
      action: INVENTORY_AUDIT_ACTIONS.STOCK_RESTOCKED,
      entity: 'Order',
      entityId: context?.orderId || null,
      actorId: context?.actorId || null,
      actorEmail: context?.actorEmail || null,
      metadata: {
        orderNumber: context?.orderNumber,
        items: result.restockedItems,
        reason: context?.reason,
      },
    }).catch((err) => logger.warn({ err: err.message }, 'Failed to record audit for restock'))

    return result
  }

  /**
   * GET /api/v1/admin/inventory/:productId/history
   * Retrieve audit logs and historical adjustments for a product.
   */
  public static async getInventoryHistory(
    productIdOrSlug: string,
    page = 1,
    limit = 20
  ) {
    const pageNum = Math.max(1, page)
    const limitNum = Math.min(100, Math.max(1, limit))

    const product = await prisma.product.findFirst({
      where: {
        OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
      },
    })

    if (!product) {
      throw new NotFoundError(`Product '${productIdOrSlug}' not found`)
    }

    const total = await prisma.inventoryLog.count({
      where: { productId: product.id },
    })

    const logs = await prisma.inventoryLog.findMany({
      where: { productId: product.id },
      include: {
        actor: { select: { id: true, fullName: true, email: true, role: true } },
        product: { select: { id: true, name: true, sku: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    })

    return {
      items: logs.map((log) => this.formatInventoryLog(log)),
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    }
  }

  /**
   * Low-Stock Alerts for Admin/Staff Dashboard.
   */
  public static async getLowStockAlerts(page = 1, limit = 50) {
    return this.listInventory({
      page,
      limit,
      lowStockOnly: true,
    })
  }
}
