import { Router } from 'express'
import { InvoiceController } from '../controllers/invoice.controller'
import { requirePermission } from '../middleware/auth.middleware'
import { authenticateOrderAccess } from '../middleware/order-auth.middleware'

/**
 * Invoice routes, mounted under `/api/v1/invoices`.
 *
 * SECURITY: this router previously declared no authentication middleware at
 * all — only comments stating that authorization "should" be applied. Because
 * `req.user` was therefore always undefined, `InvoiceController.listInvoices`
 * resolved `admin = false` and `userId = undefined`, and
 * `InvoiceService.listInvoices` skips the `where.userId` clause for a falsy
 * userId. The result was an unauthenticated endpoint that returned every
 * invoice in the platform, including customer names, emails, phone numbers,
 * shipping address snapshots and line items.
 *
 * Every route below now requires an authenticated session — either a signed-in
 * customer access token or an anonymous order-access token from checkout.
 * Ownership is enforced inside the controller/service for customer-facing
 * reads, and mutating actions require an explicit permission.
 */
const router = Router()

router.use(authenticateOrderAccess)

// Customer-scoped reads. The controller restricts these to the caller's own
// invoices unless the caller holds OWNER/ADMIN.
router.get('/', InvoiceController.listInvoices)
router.get('/order/:orderId', InvoiceController.getInvoiceByOrderId)
router.get('/:id', InvoiceController.getInvoice)
router.get('/:id/download', InvoiceController.getInvoiceDownloadUrl)

// Administrative mutations. `invoices.create` is the permission the RBAC seed
// actually grants for invoice generation/voiding; OWNER and ADMIN bypass the
// permission check entirely.
router.post(
  '/:id/regenerate',
  requirePermission('invoices.create'),
  InvoiceController.regenerateInvoicePdf
)
router.post(
  '/:id/cancel',
  requirePermission('invoices.create'),
  InvoiceController.cancelInvoice
)

export const invoiceRoutes = router