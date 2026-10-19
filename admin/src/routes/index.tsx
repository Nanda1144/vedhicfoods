import { lazy, useEffect, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AdminLayout, RequireAdmin } from '@/components/admin'
import { AdminNotFoundPage } from '@/pages/admin/AdminNotFoundPage'
import { RouteErrorPage } from '@/pages/admin/RouteErrorPage'
import type { Permission } from '@/types'

export function lazyNamed<T extends ComponentType>(importFn: () => Promise<{ [name: string]: T }>, name: string) {
  return lazy(async () => ({ default: (await importFn())[name] }))
}

const AdminLoginPage = lazyNamed(() => import('@/pages/admin/AdminLoginPage'), 'AdminLoginPage')
const AdminDashboardPage = lazyNamed(() => import('@/pages/admin/AdminDashboardPage'), 'AdminDashboardPage')
const AdminProductsPage = lazyNamed(() => import('@/pages/admin/AdminProductsPage'), 'AdminProductsPage')
const AdminOrdersPage = lazyNamed(() => import('@/pages/admin/AdminOrdersPage'), 'AdminOrdersPage')
const AdminInventoryPage = lazyNamed(() => import('@/pages/admin/AdminInventoryPage'), 'AdminInventoryPage')
const AdminCustomersPage = lazyNamed(() => import('@/pages/admin/AdminCustomersPage'), 'AdminCustomersPage')
const AdminCustomerDetailPage = lazyNamed(() => import('@/pages/admin/AdminCustomerDetailPage'), 'AdminCustomerDetailPage')
const AdminDeliveryPage = lazyNamed(() => import('@/pages/admin/AdminDeliveryPage'), 'AdminDeliveryPage')
const AdminInvoicesPage = lazyNamed(() => import('@/pages/admin/AdminInvoicesPage'), 'AdminInvoicesPage')
const AdminDiscountsPage = lazyNamed(() => import('@/pages/admin/AdminDiscountsPage'), 'AdminDiscountsPage')
const AdminPromotionsPage = lazyNamed(() => import('@/pages/admin/AdminPromotionsPage'), 'AdminPromotionsPage')
const AdminSupportPage = lazyNamed(() => import('@/pages/admin/AdminSupportPage'), 'AdminSupportPage')
const AdminTicketDetailPage = lazyNamed(() => import('@/pages/admin/AdminTicketDetailPage'), 'AdminTicketDetailPage')
const AdminStaffPage = lazyNamed(() => import('@/pages/admin/AdminStaffPage'), 'AdminStaffPage')
const AdminPermissionsPage = lazyNamed(() => import('@/pages/admin/AdminPermissionsPage'), 'AdminPermissionsPage')
const AdminAuditLogsPage = lazyNamed(() => import('@/pages/admin/AdminAuditLogsPage'), 'AdminAuditLogsPage')
const AdminSettingsPage = lazyNamed(() => import('@/pages/admin/AdminSettingsPage'), 'AdminSettingsPage')
const AdminPaymentSettingsPage = lazyNamed(() => import('@/pages/admin/AdminPaymentSettingsPage'), 'AdminPaymentSettingsPage')
const AdminSecurityPage = lazyNamed(() => import('@/pages/admin/AdminSecurityPage'), 'AdminSecurityPage')
const AdminThemePage = lazyNamed(() => import('@/pages/admin/AdminThemePage'), 'AdminThemePage')
const AdminContactSettingsPage = lazyNamed(() => import('@/pages/admin/AdminContactSettingsPage'), 'AdminContactSettingsPage')
const AdminContentPage = lazyNamed(() => import('@/pages/admin/AdminContentPage'), 'AdminContentPage')
const AdminHeroPage = lazyNamed(() => import('@/pages/admin/AdminHeroPage'), 'AdminHeroPage')

interface RoutePageProps {
  title: string
  children: ReactNode
}

function RoutePage({ title, children }: RoutePageProps) {
  useEffect(() => {
    document.title = title
  }, [title])
  return <>{children}</>
}

const titled = (Component: ComponentType, title: string) => (
  <RoutePage title={title}>
    <Component />
  </RoutePage>
)

const guarded = (Component: ComponentType, title: string, permission: Permission) => (
  <RequireAdmin permission={permission}>{titled(Component, title)}</RequireAdmin>
)

/**
 * DUPLICATE (fixed): this route list was previously written out twice — once under
 * `/` and once under `/admin/` — as 27 literal route objects each. Every entry had
 * to be maintained twice, and any guard or title added to one tree silently did
 * not apply to the other. Worse, the bare `/` tree rendered the same
 * `<AdminLayout />`, so `/products` and `/orders` served the whole admin console
 * without the `/admin` prefix, widening the reachable surface for no reason.
 *
 * Declared once and mounted under both prefixes so the two URLs keep working,
 * which is what the duplication was evidently there to achieve.
 */
const adminChildren: RouteObject[] = [
  { index: true, element: <RequireAdmin>{titled(AdminDashboardPage, 'Dashboard · Vedhic Admin')}</RequireAdmin> },
  { path: 'products', element: guarded(AdminProductsPage, 'Products · Vedhic Admin', 'products.read') },
  { path: 'products/compare', element: guarded(AdminProductsPage, 'Products · Vedhic Admin', 'products.read') },
  { path: 'products/archive', element: guarded(AdminProductsPage, 'Products · Vedhic Admin', 'products.read') },
  // AdminProductsPage drives its create modal from `?action=new` (not a path
  // param) and has no URL-driven edit-by-id, so these resolve via redirect
  // rather than 404. Placed after the static `products/*` routes.
  { path: 'products/new', element: <Navigate to="/admin/products?action=new" replace /> },
  { path: 'products/:id', element: <Navigate to="/admin/products" replace /> },
  { path: 'inventory', element: guarded(AdminInventoryPage, 'Inventory · Vedhic Admin', 'inventory.read') },
  { path: 'orders', element: guarded(AdminOrdersPage, 'Orders · Vedhic Admin', 'orders.read') },
  { path: 'orders/:id', element: guarded(AdminOrdersPage, 'Order detail · Vedhic Admin', 'orders.read') },
  { path: 'customers', element: guarded(AdminCustomersPage, 'Customers · Vedhic Admin', 'customers.read') },
  { path: 'customers/:id', element: guarded(AdminCustomerDetailPage, 'Customer · Vedhic Admin', 'customers.read') },
  { path: 'delivery', element: guarded(AdminDeliveryPage, 'Delivery · Vedhic Admin', 'delivery.read') },
  { path: 'invoices', element: guarded(AdminInvoicesPage, 'Invoices · Vedhic Admin', 'invoices.read') },
  { path: 'discounts', element: guarded(AdminDiscountsPage, 'Discounts · Vedhic Admin', 'discounts.read') },
  { path: 'promotions', element: guarded(AdminPromotionsPage, 'Festival Promotions · Vedhic Admin', 'discounts.read') },
  { path: 'support', element: guarded(AdminSupportPage, 'Customer Support · Vedhic Admin', 'support.read') },
  { path: 'support/:id', element: guarded(AdminTicketDetailPage, 'Ticket · Vedhic Admin', 'support.read') },
  { path: 'staff', element: guarded(AdminStaffPage, 'Staff Management · Vedhic Admin', 'staff.read') },
  { path: 'staff/new', element: guarded(AdminStaffPage, 'Invite Staff · Vedhic Admin', 'staff.update') },
  { path: 'staff/:id', element: guarded(AdminStaffPage, 'Edit Staff · Vedhic Admin', 'staff.update') },
  { path: 'permissions', element: guarded(AdminPermissionsPage, 'Permissions · Vedhic Admin', 'staff.read') },
  { path: 'audit-logs', element: guarded(AdminAuditLogsPage, 'Audit Logs · Vedhic Admin', 'audit_logs.read') },
  { path: 'settings', element: guarded(AdminSettingsPage, 'Website Settings · Vedhic Admin', 'settings.read') },
  { path: 'payment-settings', element: guarded(AdminPaymentSettingsPage, 'Payment Settings · Vedhic Admin', 'settings.read') },
  { path: 'security', element: <RequireAdmin>{titled(AdminSecurityPage, 'Security · Vedhic Admin')}</RequireAdmin> },
  { path: 'theme', element: guarded(AdminThemePage, 'Branding · Vedhic Admin', 'settings.read') },
  { path: 'contact-settings', element: guarded(AdminContactSettingsPage, 'Contact Details · Vedhic Admin', 'settings.read') },
  { path: 'hero', element: guarded(AdminHeroPage, 'Homepage Hero · Vedhic Admin', 'settings.read') },
  { path: 'content', element: guarded(AdminContentPage, 'Website Content · Vedhic Admin', 'content.read') },
  { path: '*', element: titled(AdminNotFoundPage, 'Not found · Vedhic Admin') },
]

/**
 * Applied to every route. Without it a render error anywhere below unmounts the
 * whole app and the browser shows React Router's default
 * "Unexpected Application Error!" page — which is exactly what a stale-session
 * `TypeError` in `initials()` produced here.
 *
 * Index routes are spread through untouched: `RouteObject` is a union whose
 * index member forbids `children`, so spreading `children: undefined` onto one
 * breaks assignment.
 */
const withErrorBoundary = (routes: RouteObject[]): RouteObject[] =>
  routes.map(route =>
    'index' in route && route.index
      ? ({ ...route, errorElement: <RouteErrorPage /> } as RouteObject)
      : {
          ...route,
          errorElement: <RouteErrorPage />,
          children: route.children ? withErrorBoundary(route.children) : undefined,
        },
  )

export const router = createBrowserRouter(
  withErrorBoundary([
    { path: '/login', element: titled(AdminLoginPage, 'Admin sign in · Vedhic Foods') },
    { path: '/admin/login', element: titled(AdminLoginPage, 'Admin sign in · Vedhic Foods') },
    { path: '/', element: <AdminLayout />, children: adminChildren },
    { path: '/admin', element: <AdminLayout />, children: adminChildren },
    { path: '*', element: titled(AdminNotFoundPage, 'Not found · Vedhic Admin') },
  ])
)