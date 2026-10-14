import { Router } from 'express'
import { SettingsController } from '../controllers/settings.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'

const router = Router()

// Public storefront settings (safe subset only, enforced by isPublic flag).
router.get('/', SettingsController.getPublicSettings)

export const publicSettingsRoutes = router

/**
 * Admin settings sub-router. Mounted under `/api/v1/admin/settings`.
 * `settings.read`  -> view the full registry (including private keys)
 * `settings.update` -> mutate values
 */
export const adminSettingsRoutes = Router()
adminSettingsRoutes.use(authenticate)
adminSettingsRoutes.get('/', requirePermission('settings.read'), SettingsController.listSettings)
adminSettingsRoutes.put('/', requirePermission('settings.update'), SettingsController.bulkUpsertSettings)
adminSettingsRoutes.get('/:key', requirePermission('settings.read'), SettingsController.getSetting)
adminSettingsRoutes.put('/:key', requirePermission('settings.update'), SettingsController.upsertSetting)
