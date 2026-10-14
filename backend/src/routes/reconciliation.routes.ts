import { Router } from 'express'
import { ReconciliationController } from '../controllers/reconciliation.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'

/**
 * Payment & invoice reconciliation endpoints.
 *
 * SECURITY: this router previously carried no middleware at all (only a
 * `// Admin-only middleware` comment). Mounted at `/api/v1/payments/reconciliation`
 * and `/api/v1/invoices/reconciliation`, it exposed — to anonymous callers —
 * revenue totals, per-order amounts, Razorpay order/payment IDs, and explicit
 * "mismatch" reports describing where local records disagree with the gateway.
 *
 * Reconciliation is a privileged financial-reporting surface: it now requires an
 * authenticated session plus the `reports.read` permission. OWNER and ADMIN
 * bypass the permission check.
 *
 * ROUTING (correctness): a single router mounted at two prefixes meant the route
 * table — defined once — was served identically under both prefixes. In practice
 * `GET /api/v1/invoices/reconciliation` (bare) matched the payments report
 * handler (`router.get('/')`), which calls the Razorpay gateway; the invoice
 * report was only reachable at the unintuitive `/invoices/reconciliation/invoices`
 * alias. The prefixes now carry dedicated routers so the bare invoices mount
 * serves the invoice report and never touches Razorpay.
 */

function paymentRoutes(): Router {
  const router = Router()
  router.use(authenticate)

  // GET /api/v1/payments/reconciliation
  router.get(
    '/',
    requirePermission('reports.read'),
    ReconciliationController.getReconciliationReport
  )

  // GET /api/v1/payments/reconciliation/invoices
  //
  // ROUTE ORDER (correctness): this MUST be registered above `/:razorpayOrderId`.
  // Express matches in declaration order, so with the parameterised route first,
  // `GET /payments/reconciliation/invoices` was captured by it and handed to
  // `reconcileSingleOrder('invoices')`. That looked up a payment whose
  // `razorpayOrderId` equals the literal string "invoices", found nothing, and
  // returned 404 — so `getInvoiceReconciliation` was unreachable dead code.
  router.get(
    '/invoices',
    requirePermission('reports.read'),
    ReconciliationController.getInvoiceReconciliation
  )

  // GET /api/v1/payments/reconciliation/:razorpayOrderId
  router.get(
    '/:razorpayOrderId',
    requirePermission('reports.read'),
    ReconciliationController.reconcileSingleOrder
  )

  return router
}

function invoiceRoutes(): Router {
  const router = Router()
  router.use(authenticate)

  // GET /api/v1/invoices/reconciliation
  router.get(
    '/',
    requirePermission('reports.read'),
    ReconciliationController.getInvoiceReconciliation
  )

  return router
}

export const reconciliationRoutes = paymentRoutes()
export const invoiceReconciliationRoutes = invoiceRoutes()