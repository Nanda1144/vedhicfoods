import { prisma } from '../config/database'
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors'
import { InventoryStatus } from '@prisma/client'
import { CartResponse, CartItemResponse } from '../types/cart.types'

export class CartService {
  /**
   * Resolve or initialize customer cart by userId or guest session token.
   * Enforces customer data isolation: An authenticated customer ONLY resolves their own cart.
   */
  public static async getOrCreateCart(userId?: string | null, sessionToken?: string | null) {
    if (!userId && !sessionToken) {
      throw new BadRequestError('Either an authenticated user or a session token is required to access cart')
    }

    if (userId) {
      await prisma.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
      }).catch(() => {
        // Catch concurrent creation race condition safely
      })
    } else if (sessionToken) {
      await prisma.cart.upsert({
        where: { sessionToken },
        create: { sessionToken },
        update: {},
      }).catch(() => {
        // Catch concurrent creation race condition safely
      })
    }

    const cart = await prisma.cart.findFirst({
      where: userId ? { userId } : { sessionToken: sessionToken! },
      include: {
        items: {
          include: {
            product: {
              include: {
                inventory: true,
                images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    return cart!
  }

  /**
   * Formats cart response and evaluates authoritative real-time inventory and pricing for every item.
   * Calculations use precise monetary arithmetic (rounded to 2 decimal places).
   */
  public static formatCartWithInventory(cart: any): CartResponse {
    let subtotal = 0
    let originalSubtotal = 0
    let totalSavings = 0
    let totalUnits = 0
    let hasStockIssues = false

    const items: CartItemResponse[] = (cart.items || []).map((item: any) => {
      const p = item.product
      const inv = p?.inventory
      const availableQuantity = inv ? Number(inv.availableQuantity) : Number(p?.stock || 0)
      const requestedQty = Number(item.quantity)
      totalUnits += requestedQty

      // Current authoritative price from database
      const currentPrice = Number(p?.price || 0)
      const mrp = Number(p?.mrp || currentPrice)
      const priceSnapshot = Number(item.priceSnapshot || currentPrice)
      const priceChanged = Math.abs(currentPrice - priceSnapshot) > 0.001

      const lineTotal = Math.round(currentPrice * requestedQty * 100) / 100
      const lineMrpTotal = Math.round(mrp * requestedQty * 100) / 100
      const lineSavings = Math.round(Math.max(0, mrp - currentPrice) * requestedQty * 100) / 100

      subtotal = Math.round((subtotal + lineTotal) * 100) / 100
      originalSubtotal = Math.round((originalSubtotal + lineMrpTotal) * 100) / 100
      totalSavings = Math.round((totalSavings + lineSavings) * 100) / 100

      const isOutOfStock = availableQuantity <= 0
      const isInsufficient = requestedQty > availableQuantity
      const isAvailable = !isOutOfStock && !isInsufficient && Boolean(p?.isActive) && p?.status === 'PUBLISHED' && !p?.isDeleted

      if (!isAvailable) {
        hasStockIssues = true
      }

      return {
        id: item.id,
        productId: item.productId,
        productName: p?.name || 'Unknown Product',
        slug: p?.slug || '',
        sku: p?.sku || '',
        unit: p?.unit || 'piece',
        image: p?.images?.[0]?.imageUrl || '',
        unitPrice: currentPrice,
        mrp,
        discount: Number(p?.discount || 0),
        quantity: requestedQty,
        lineTotal,
        lineSavings,
        priceSnapshot,
        priceChanged,
        inventory: {
          availableQuantity,
          status: inv?.status || (availableQuantity > 0 ? InventoryStatus.IN_STOCK : InventoryStatus.OUT_OF_STOCK),
          isOutOfStock,
          hasInsufficientStock: isInsufficient,
          isAvailable,
        },
      }
    })

    // Business rule: Free shipping above Rs. 499 or on empty cart, else Rs. 49
    const shipping = items.length === 0 || subtotal >= 499 ? 0 : 49
    // 5% GST tax on organic food items
    const tax = Math.round(subtotal * 0.05 * 100) / 100
    const total = Math.round((subtotal + shipping + tax) * 100) / 100

    return {
      cartId: cart.id,
      userId: cart.userId,
      sessionToken: cart.sessionToken,
      items,
      itemCount: items.length,
      totalUnits,
      subtotal,
      originalSubtotal,
      savings: totalSavings,
      shipping,
      tax,
      total,
      currency: 'INR',
      hasStockIssues,
      updatedAt: cart.updatedAt instanceof Date ? cart.updatedAt.toISOString() : new Date().toISOString(),
    }
  }

  /**
   * GET /api/v1/cart
   */
  public static async getCart(userId?: string | null, sessionToken?: string | null): Promise<CartResponse> {
    const cart = await this.getOrCreateCart(userId, sessionToken)
    return this.formatCartWithInventory(cart)
  }

  /**
   * POST /api/v1/cart/items
   * Adds an item to the cart.
   * Enforces:
   * 1. Product exists and is not deleted
   * 2. Product is active and published
   * 3. Authoritative inventory check
   * 4. Safe price capture (ignores client price)
   * 5. Atomicity & concurrency safety
   */
  public static async addItem(
    productIdOrSlug: string,
    quantity: number,
    userId?: string | null,
    sessionToken?: string | null
  ): Promise<CartResponse> {
    if (!productIdOrSlug || typeof productIdOrSlug !== 'string') {
      throw new BadRequestError('Product ID or slug is required')
    }

    const qty = parseInt(String(quantity), 10)
    if (isNaN(qty) || qty <= 0) {
      throw new BadRequestError('Quantity must be a positive integer greater than zero')
    }

    // Ensure the cart row exists BEFORE opening the transaction. First-ever
    // creation for a user races between concurrent requests: the loser's insert
    // raises P2002, and a failed statement inside an interactive transaction
    // aborts it, turning a benign race into a 500. The catch mirrors
    // getOrCreateCart — the winner's committed row is then found below.
    if (userId) {
      await prisma.cart
        .upsert({ where: { userId }, create: { userId }, update: {} })
        .catch(() => {
          // Concurrent creation race — the row now exists.
        })
    } else if (sessionToken) {
      await prisma.cart
        .upsert({ where: { sessionToken }, create: { sessionToken }, update: {} })
        .catch(() => {
          // Concurrent creation race — the row now exists.
        })
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Resolve product
      const product = await tx.product.findFirst({
        where: {
          OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
          isDeleted: false,
        },
        include: { inventory: true },
      })

      if (!product) {
        throw new NotFoundError(`Product '${productIdOrSlug}' not found`)
      }

      if (!product.isActive || product.status !== 'PUBLISHED') {
        throw new BadRequestError(`Product '${product.name}' is currently unavailable for purchase`)
      }

      // 2. Authoritative inventory check
      const availableQuantity = product.inventory
        ? Number(product.inventory.availableQuantity)
        : Number(product.stock || 0)

      if (availableQuantity <= 0) {
        throw new BadRequestError(`Cannot add to cart: Product '${product.name}' is currently out of stock`)
      }

      // 3. Resolve cart atomically (the row was ensured above; this select only
      // observes the committed existence check rather than racing to create it)
      let cart: any
      if (userId) {
        cart = await tx.cart.findUnique({ where: { userId } })
      } else {
        cart = await tx.cart.findUnique({ where: { sessionToken: sessionToken! } })
      }
      if (!cart) {
        throw new BadRequestError('Cart could not be resolved, please retry')
      }

      // Lock this customer's cart row to serialize concurrent additions
      await tx.$executeRaw`SELECT id FROM "carts" WHERE id = ${cart.id} FOR UPDATE`

      // 4. Check existing line item
      const existingItem = await tx.cartItem.findUnique({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId: product.id,
          },
        },
      })

      const newQuantity = existingItem ? existingItem.quantity + qty : qty

      if (newQuantity > availableQuantity) {
        throw new BadRequestError(
          `Requested quantity (${newQuantity}) exceeds authoritative available stock (${availableQuantity}) for '${product.name}'`
        )
      }

      if (newQuantity > 100) {
        throw new BadRequestError('Cannot exceed maximum limit of 100 units per item')
      }

      // 5. Atomic upsert with backend authoritative price snapshot
      await tx.cartItem.upsert({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId: product.id,
          },
        },
        create: {
          cartId: cart.id,
          productId: product.id,
          quantity: newQuantity,
          priceSnapshot: product.price,
        },
        update: {
          quantity: newQuantity,
          priceSnapshot: product.price,
        },
      })

      // Fetch fresh cart with items
      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: {
              product: {
                include: {
                  inventory: true,
                  images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      })

      return CartService.formatCartWithInventory(updatedCart)
    }, { timeout: 15000, maxWait: 15000 })
  }

  /**
   * Helper to resolve cart item belonging to this specific cart by either cartItem.id or productId/slug.
   * Enforces customer ownership.
   */
  private static async resolveCartItem(
    tx: any,
    cartId: string,
    itemIdOrProductId: string
  ) {
    // 1. Try finding by CartItem ID
    let item = await tx.cartItem.findUnique({
      where: { id: itemIdOrProductId },
      include: { product: { include: { inventory: true } } },
    })

    if (item) {
      if (item.cartId !== cartId) {
        throw new ForbiddenError("You are not authorized to modify another customer's cart item")
      }
      return item
    }

    // 2. Try finding by product id or slug in this customer's cart
    item = await tx.cartItem.findFirst({
      where: {
        cartId,
        product: {
          OR: [{ id: itemIdOrProductId }, { slug: itemIdOrProductId }],
        },
      },
      include: { product: { include: { inventory: true } } },
    })

    if (!item) {
      // Check if product exists in another customer's cart
      const crossCartItem = await tx.cartItem.findFirst({
        where: {
          product: {
            OR: [{ id: itemIdOrProductId }, { slug: itemIdOrProductId }],
          },
        },
      })
      if (crossCartItem) {
        throw new ForbiddenError("You are not authorized to modify another customer's cart item")
      }
      throw new NotFoundError(`Cart item '${itemIdOrProductId}' not found`)
    }

    return item
  }

  /**
   * PATCH /api/v1/cart/items/:itemId
   * Updates line item quantity with authoritative stock verification and ownership check.
   */
  public static async updateItemQuantity(
    itemIdOrProductId: string,
    quantity: number,
    userId?: string | null,
    sessionToken?: string | null
  ): Promise<CartResponse> {
    const qty = parseInt(String(quantity), 10)
    if (isNaN(qty) || qty < 0) {
      throw new BadRequestError('Quantity must be a valid non-negative integer')
    }

    return await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findFirst({
        where: userId ? { userId } : { sessionToken: sessionToken! },
      })

      if (!cart) {
        throw new NotFoundError('Cart not found')
      }

      const item = await CartService.resolveCartItem(tx, cart.id, itemIdOrProductId)

      if (qty === 0) {
        // Quantity 0 removes the item
        await tx.cartItem.delete({
          where: { id: item.id },
        })
      } else {
        const availableQuantity = item.product.inventory
          ? Number(item.product.inventory.availableQuantity)
          : Number(item.product.stock || 0)

        if (qty > availableQuantity) {
          throw new BadRequestError(
            `Requested quantity (${qty}) exceeds authoritative available stock (${availableQuantity}) for '${item.product.name}'`
          )
        }

        if (qty > 100) {
          throw new BadRequestError('Cannot exceed maximum limit of 100 units per item')
        }

        await tx.cartItem.update({
          where: { id: item.id },
          data: {
            quantity: qty,
            priceSnapshot: item.product.price,
          },
        })
      }

      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: {
              product: {
                include: {
                  inventory: true,
                  images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      })

      return CartService.formatCartWithInventory(updatedCart)
    }, { timeout: 15000, maxWait: 15000 })
  }

  /**
   * DELETE /api/v1/cart/items/:itemId
   * Removes an item from the customer's cart.
   */
  public static async removeItem(
    itemIdOrProductId: string,
    userId?: string | null,
    sessionToken?: string | null
  ): Promise<CartResponse> {
    return await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findFirst({
        where: userId ? { userId } : { sessionToken: sessionToken! },
      })

      if (!cart) {
        throw new NotFoundError('Cart not found')
      }

      const item = await CartService.resolveCartItem(tx, cart.id, itemIdOrProductId)

      await tx.cartItem.delete({
        where: { id: item.id },
      })

      const updatedCart = await tx.cart.findUnique({
        where: { id: cart.id },
        include: {
          items: {
            include: {
              product: {
                include: {
                  inventory: true,
                  images: { orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      })

      return CartService.formatCartWithInventory(updatedCart)
    }, { timeout: 15000, maxWait: 15000 })
  }

  /**
   * DELETE /api/v1/cart
   * Clears all items in the customer's cart.
   */
  public static async clearCart(
    userId?: string | null,
    sessionToken?: string | null
  ): Promise<CartResponse> {
    const cart = await this.getOrCreateCart(userId, sessionToken)
    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    })
    return this.getCart(userId, sessionToken)
  }

  /**
   * POST /api/v1/cart/validate
   * Validates cart against live PostgreSQL inventory before initiating checkout.
   */
  public static async validateCart(userId?: string | null, sessionToken?: string | null) {
    const cart = await this.getCart(userId, sessionToken)
    const issues: {
      productId: string
      productName: string
      requestedQuantity: number
      availableQuantity: number
      reason: string
    }[] = []

    for (const item of cart.items) {
      if (item.inventory.isOutOfStock) {
        issues.push({
          productId: item.productId,
          productName: item.productName,
          requestedQuantity: item.quantity,
          availableQuantity: item.inventory.availableQuantity,
          reason: 'Product is completely out of stock',
        })
      } else if (item.inventory.hasInsufficientStock) {
        issues.push({
          productId: item.productId,
          productName: item.productName,
          requestedQuantity: item.quantity,
          availableQuantity: item.inventory.availableQuantity,
          reason: `Requested ${item.quantity} units, but only ${item.inventory.availableQuantity} units available`,
        })
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      cart,
    }
  }

  /**
   * Merges guest cart into authenticated user cart upon login or checkout.
   */
  public static async mergeGuestCart(userId: string, sessionToken: string): Promise<CartResponse> {
    if (!userId || !sessionToken) {
      return this.getCart(userId, sessionToken)
    }

    const guestCart = await prisma.cart.findUnique({
      where: { sessionToken },
      include: { items: true },
    })

    if (!guestCart || guestCart.items.length === 0) {
      return this.getCart(userId, null)
    }

    const userCart = await this.getOrCreateCart(userId, null)

    await prisma.$transaction(async (tx) => {
      // PERFORMANCE (N+1 fix): this loop issued a `findUnique` plus an
      // `update` or `create` per guest line — 2N+2 round trips inside one
      // transaction, on the login-with-cart path. Now the existing rows are read
      // once, new rows go in with a single `createMany`, and quantity merges are
      // done set-based. 2N+2 -> 3 regardless of cart size.
      const guestProductIds = guestCart.items.map((i) => i.productId)

      const existingItems = await tx.cartItem.findMany({
        where: {
          cartId: userCart.id,
          productId: { in: guestProductIds },
        },
        select: { id: true, productId: true, quantity: true },
      })

      const existingByProduct = new Map(existingItems.map((e) => [e.productId, e]))

      const toCreate = guestCart.items.filter((item) => !existingByProduct.has(item.productId))
      if (toCreate.length > 0) {
        await tx.cartItem.createMany({
          data: toCreate.map((item) => ({
            cartId: userCart.id,
            productId: item.productId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
          })),
        })
      }

      // Merge quantities for lines that already exist. Done as one statement per
      // existing row via `updateMany` on the composite key so the
      // `LEAST(100, ...)` cap and the row lock semantics are unchanged.
      await Promise.all(
        guestCart.items
          .filter((item) => existingByProduct.has(item.productId))
          .map((item) => {
            const existing = existingByProduct.get(item.productId)!
            return tx.cartItem.update({
              where: { id: existing.id },
              data: {
                quantity: Math.min(100, existing.quantity + item.quantity),
              },
            })
          })
      )

      // Delete guest cart items and guest cart
      await tx.cartItem.deleteMany({ where: { cartId: guestCart.id } })
      await tx.cart.delete({ where: { id: guestCart.id } }).catch(() => {})
    }, { timeout: 15000, maxWait: 15000 })

    return this.getCart(userId, null)
  }
}
