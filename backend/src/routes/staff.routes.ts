import { Router } from 'express'
import { StaffController } from '../controllers/staff.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'

const router = Router()

// All staff endpoints require authentication
router.use(authenticate)

// Staff Directory & CRUD
router.get('/', requirePermission('staff.read'), StaffController.listStaff)
router.get('/:id', requirePermission('staff.read'), StaffController.getStaffById)
router.post('/', requirePermission('staff.create'), StaffController.createStaff)
router.patch('/:id', requirePermission('staff.update'), StaffController.updateStaff)
router.patch('/:id/permissions', requirePermission('staff.update'), StaffController.updateStaffPermissions)
router.post('/:id/reset-password', requirePermission('staff.update'), StaffController.resetStaffPassword)
router.delete('/:id', requirePermission('staff.delete'), StaffController.deleteStaff)

export const staffRoutes = router
