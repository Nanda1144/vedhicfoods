import { Router } from 'express'
import { ReportController } from '../controllers/report.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'

/**
 * Date-windowed reporting API.
 *
 * SECURITY: mirrors the reconciliation router — an authenticated session plus
 * the `reports.read` permission (OWNER/ADMIN inherit it) is mandatory. The
 * dashboard/analytics endpoints share the same slug, so this surface is
 * locked to the exact same audience.
 */
const router = Router()

router.use(authenticate)

// GET /api/v1/admin/reports/:dimension
router.get('/:dimension', requirePermission('reports.read'), ReportController.getReport)

export const reportRoutes = router