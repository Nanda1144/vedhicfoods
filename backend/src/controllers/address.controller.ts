import { Request, Response } from 'express'
import { AddressService } from '../services/address.service'
import { logger } from '../config/logger'
import { sendControllerError } from '../utils/api-response'
import { RoleName } from '@prisma/client'

export class AddressController {
  private static isPrivilegedUser(req: Request): boolean {
    if (!req.user) return false
    return (
      req.user.role === RoleName.ADMIN ||
      req.user.role === RoleName.OWNER ||
      req.user.roles?.includes(RoleName.ADMIN) ||
      req.user.roles?.includes(RoleName.OWNER)
    )
  }

  public static async createAddress(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const address = await AddressService.createAddress(userId, req.body)

      logger.info({ userId, addressId: address.id }, 'Customer address created successfully')
      res.status(201).json({
        success: true,
        message: 'Address created successfully',
        data: address,
        address,
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create customer address')
      sendControllerError(res, error, 'Failed to create customer address', req.id)
    }
  }

  public static async getAddresses(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const addresses = await AddressService.getAddresses(userId)

      res.status(200).json({
        success: true,
        count: addresses.length,
        items: addresses,
        addresses,
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list customer addresses')
      sendControllerError(res, error, 'Failed to list customer addresses', req.id)
    }
  }

  public static async getAddressById(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const addressId = String(req.params.id)
      const isAdmin = AddressController.isPrivilegedUser(req)

      const address = await AddressService.getAddressById(userId, addressId, isAdmin)

      res.status(200).json({
        success: true,
        data: address,
        address,
      })
    } catch (error: any) {
      logger.error({ error: error.message, addressId: req.params.id }, 'Failed to fetch customer address')
      sendControllerError(res, error, 'Failed to fetch customer address', req.id)
    }
  }

  public static async updateAddress(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const addressId = String(req.params.id)
      const isAdmin = AddressController.isPrivilegedUser(req)

      const address = await AddressService.updateAddress(userId, addressId, req.body, isAdmin)

      logger.info({ userId, addressId }, 'Customer address updated successfully')
      res.status(200).json({
        success: true,
        message: 'Address updated successfully',
        data: address,
        address,
      })
    } catch (error: any) {
      logger.error({ error: error.message, addressId: req.params.id }, 'Failed to update customer address')
      sendControllerError(res, error, 'Failed to update customer address', req.id)
    }
  }

  public static async deleteAddress(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const addressId = String(req.params.id)
      const isAdmin = AddressController.isPrivilegedUser(req)

      const result = await AddressService.deleteAddress(userId, addressId, isAdmin)

      logger.info({ userId, addressId }, 'Customer address deleted successfully')
      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message, addressId: req.params.id }, 'Failed to delete customer address')
      sendControllerError(res, error, 'Failed to delete customer address', req.id)
    }
  }

  public static async setDefaultAddress(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const addressId = String(req.params.id)
      const isAdmin = AddressController.isPrivilegedUser(req)

      const address = await AddressService.setDefaultAddress(userId, addressId, isAdmin)

      logger.info({ userId, addressId }, 'Customer default address updated successfully')
      res.status(200).json({
        success: true,
        message: 'Default address updated successfully',
        data: address,
        address,
      })
    } catch (error: any) {
      logger.error({ error: error.message, addressId: req.params.id }, 'Failed to set default customer address')
      sendControllerError(res, error, 'Failed to set default address', req.id)
    }
  }
}
