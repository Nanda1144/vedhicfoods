import { Router } from 'express'
import { InventoryController } from '../controllers/inventory.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'

const router = Router()

// All inventory endpoints require authentication
router.use(authenticate)

// Low-stock warehouse alerts (Must be registered before :productId)
router.get(
  '/low-stock',
  requirePermission('inventory.read'),
  InventoryController.getLowStockAlerts
)

// List warehouse inventory
router.get(
  '/',
  requirePermission('inventory.read'),
  InventoryController.listInventory
)

// Single product inventory details
router.get(
  '/:productId',
  requirePermission('inventory.read'),
  InventoryController.getInventory
)

// Update thresholds or status
router.patch(
  '/:productId',
  requirePermission('inventory.update'),
  InventoryController.updateInventory
)

// Manual stock adjustments (ADD_STOCK, REMOVE_STOCK, RESTOCK, MANUAL_ADJUSTMENT)
router.post(
  '/:productId/adjust',
  requirePermission('inventory.update'),
  InventoryController.adjustStock
)

// Historical movement logs
router.get(
  '/:productId/history',
  requirePermission('inventory.read'),
  InventoryController.getHistory
)

export const inventoryRoutes = router
