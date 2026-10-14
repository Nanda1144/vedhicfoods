import { Router } from 'express'
import { DeliveryController } from '../controllers/delivery.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'

const router = Router()

// All admin delivery endpoints require authentication
router.use(authenticate)

// GET /api/v1/admin/delivery
router.get(
  '/',
  requirePermission('delivery.read'),
  DeliveryController.listDeliveries
)

// GET /api/v1/admin/delivery/:id
router.get(
  '/:id',
  requirePermission('delivery.read'),
  DeliveryController.getDelivery
)

// PATCH /api/v1/admin/delivery/:id
router.patch(
  '/:id',
  requirePermission('delivery.update'),
  DeliveryController.updateDelivery
)

// POST /api/v1/admin/delivery/:id/assign
router.post(
  '/:id/assign',
  requirePermission('delivery.assign'),
  DeliveryController.assignDelivery
)

// PATCH /api/v1/admin/delivery/:id/status
router.patch(
  '/:id/status',
  requirePermission('delivery.update'),
  DeliveryController.updateDeliveryStatus
)

export const deliveryRoutes = router
