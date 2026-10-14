import { Router } from 'express'
import { AddressController } from '../controllers/address.controller'
import { requireAuth } from '../middleware/auth.middleware'

const router = Router()

// All customer address routes require authentication
router.use('/addresses', requireAuth)

router.post('/addresses', AddressController.createAddress)
router.get('/addresses', AddressController.getAddresses)
router.get('/addresses/:id', AddressController.getAddressById)
router.patch('/addresses/:id', AddressController.updateAddress)
router.delete('/addresses/:id', AddressController.deleteAddress)
router.patch('/addresses/:id/default', AddressController.setDefaultAddress)

export const customerRoutes = router
