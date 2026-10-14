import { prisma } from '../config/database'
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors'
import {
  createAddressSchema,
  updateAddressSchema,
  CreateAddressDTO,
  UpdateAddressDTO,
  AddressResponse,
} from '../types/address.types'
import { Address } from '@prisma/client'

export class AddressService {
  /**
   * Normalize and format database Address model to API response
   */
  public static formatAddress(address: Address): AddressResponse {
    return {
      id: address.id,
      userId: address.userId,
      label: address.label,
      type: address.type,
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country,
      isDefault: address.isDefault,
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
    }
  }

  /**
   * POST /api/v1/customer/addresses
   * Create an address for the authenticated customer.
   */
  public static async createAddress(userId: string, input: unknown): Promise<AddressResponse> {
    const parsed = createAddressSchema.safeParse(input)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Validation failed'
      throw new BadRequestError(firstError, parsed.error.issues)
    }

    const data: CreateAddressDTO = parsed.data

    return await prisma.$transaction(async (tx) => {
      // Check if this is the customer's first active address
      const existingCount = await tx.address.count({
        where: {
          userId,
          isDeleted: false,
        },
      })

      // If user has no existing addresses, this one must be default
      const shouldBeDefault = existingCount === 0 || data.isDefault === true

      if (shouldBeDefault && existingCount > 0) {
        // Demote all existing default addresses for this customer
        await tx.address.updateMany({
          where: {
            userId,
            isDeleted: false,
          },
          data: {
            isDefault: false,
          },
        })
      }

      const created = await tx.address.create({
        data: {
          userId,
          label: data.label,
          type: data.type,
          fullName: data.fullName,
          phone: data.phone,
          line1: data.line1,
          line2: data.line2 || null,
          landmark: data.landmark || null,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          country: data.country || 'India',
          isDefault: shouldBeDefault,
        },
      })

      return AddressService.formatAddress(created)
    })
  }

  /**
   * GET /api/v1/customer/addresses
   * List all non-deleted addresses for the customer, with default address first.
   */
  public static async getAddresses(userId: string): Promise<AddressResponse[]> {
    const addresses = await prisma.address.findMany({
      where: {
        userId,
        isDeleted: false,
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    })

    return addresses.map(AddressService.formatAddress)
  }

  /**
   * GET /api/v1/customer/addresses/:id
   * Fetch single address by ID with strict customer ownership enforcement.
   */
  public static async getAddressById(
    userId: string,
    addressId: string,
    isAdmin = false
  ): Promise<AddressResponse> {
    const address = await prisma.address.findUnique({
      where: { id: addressId },
    })

    if (!address || address.isDeleted) {
      throw new NotFoundError('Address not found')
    }

    // Ownership check: customer can only access their own address
    if (address.userId !== userId && !isAdmin) {
      throw new ForbiddenError("You are not authorized to access another customer's address")
    }

    return AddressService.formatAddress(address)
  }

  /**
   * PATCH /api/v1/customer/addresses/:id
   * Update address fields with strict ownership check and default address management.
   */
  public static async updateAddress(
    userId: string,
    addressId: string,
    input: unknown,
    isAdmin = false
  ): Promise<AddressResponse> {
    const parsed = updateAddressSchema.safeParse(input)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Validation failed'
      throw new BadRequestError(firstError, parsed.error.issues)
    }

    const data: UpdateAddressDTO = parsed.data

    const existing = await prisma.address.findUnique({
      where: { id: addressId },
    })

    if (!existing || existing.isDeleted) {
      throw new NotFoundError('Address not found')
    }

    if (existing.userId !== userId && !isAdmin) {
      throw new ForbiddenError("You are not authorized to modify another customer's address")
    }

    return await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        // Demote all other addresses for this user
        await tx.address.updateMany({
          where: {
            userId: existing.userId,
            id: { not: addressId },
            isDeleted: false,
          },
          data: {
            isDefault: false,
          },
        })
      }

      const updated = await tx.address.update({
        where: { id: addressId },
        data: {
          ...(data.label !== undefined && { label: data.label }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.fullName !== undefined && { fullName: data.fullName }),
          ...(data.phone !== undefined && { phone: data.phone }),
          ...(data.line1 !== undefined && { line1: data.line1 }),
          ...(data.line2 !== undefined && { line2: data.line2 }),
          ...(data.landmark !== undefined && { landmark: data.landmark }),
          ...(data.city !== undefined && { city: data.city }),
          ...(data.state !== undefined && { state: data.state }),
          ...(data.pincode !== undefined && { pincode: data.pincode }),
          ...(data.country !== undefined && { country: data.country }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        },
      })

      return AddressService.formatAddress(updated)
    })
  }

  /**
   * DELETE /api/v1/customer/addresses/:id
   * Soft-delete address safely to preserve historical order references.
   * If the default address is deleted, promote the next latest address to default.
   */
  public static async deleteAddress(
    userId: string,
    addressId: string,
    isAdmin = false
  ): Promise<{ success: boolean; message: string }> {
    const existing = await prisma.address.findUnique({
      where: { id: addressId },
    })

    if (!existing || existing.isDeleted) {
      throw new NotFoundError('Address not found')
    }

    if (existing.userId !== userId && !isAdmin) {
      throw new ForbiddenError("You are not authorized to delete another customer's address")
    }

    await prisma.$transaction(async (tx) => {
      // Soft-delete
      await tx.address.update({
        where: { id: addressId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          isDefault: false,
        },
      })

      // If this was default, promote the newest remaining active address
      if (existing.isDefault) {
        const nextDefault = await tx.address.findFirst({
          where: {
            userId: existing.userId,
            isDeleted: false,
            id: { not: addressId },
          },
          orderBy: { createdAt: 'desc' },
        })

        if (nextDefault) {
          await tx.address.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          })
        }
      }
    })

    return { success: true, message: 'Address deleted successfully' }
  }

  /**
   * PATCH /api/v1/customer/addresses/:id/default
   * Sets this address as the default shipping address.
   */
  public static async setDefaultAddress(
    userId: string,
    addressId: string,
    isAdmin = false
  ): Promise<AddressResponse> {
    const existing = await prisma.address.findUnique({
      where: { id: addressId },
    })

    if (!existing || existing.isDeleted) {
      throw new NotFoundError('Address not found')
    }

    if (existing.userId !== userId && !isAdmin) {
      throw new ForbiddenError("You are not authorized to modify another customer's address")
    }

    return await prisma.$transaction(async (tx) => {
      // Demote all active addresses of this customer
      await tx.address.updateMany({
        where: {
          userId: existing.userId,
          isDeleted: false,
        },
        data: {
          isDefault: false,
        },
      })

      // Promote this address
      const updated = await tx.address.update({
        where: { id: addressId },
        data: {
          isDefault: true,
        },
      })

      return AddressService.formatAddress(updated)
    })
  }
}
