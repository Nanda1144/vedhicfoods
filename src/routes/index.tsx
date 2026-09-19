import { lazy, useEffect, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { CustomerLayout } from '@/layouts/CustomerLayout'
import { AdminLayout, RequireAdmin } from '@/components/admin'
import { NotFoundPage } from '@/pages/customer/NotFoundPage'
import type { Permission } from '@/types'

export function lazyNamed<T extends ComponentType>(importFn: () => Promise<{ [name: string]: T }>, name: string) {
  return lazy(async () => ({ default: (await importFn())[name] }))
}

const HomePage = lazyNamed(() => import('@/pages/customer/HomePage'), 'HomePage')
const AboutPage = lazyNamed(() => import('@/pages/customer/AboutPage'), 'AboutPage')
const CategoriesPage = lazyNamed(() => import('@/pages/customer/CategoriesPage'), 'CategoriesPage')
const ShopPage = lazyNamed(() => import('@/pages/customer/ShopPage'), 'ShopPage')
const ProductDetailPage = lazyNamed(() => import('@/pages/customer/ProductDetailPage'), 'ProductDetailPage')
const CartPage = lazyNamed(() => import('@/pages/customer/CartPage'), 'CartPage')
const CheckoutPage = lazyNamed(() => import('@/pages/customer/CheckoutPage'), 'CheckoutPage')
const OrderSuccessPage = lazyNamed(() => import('@/pages/customer/OrderSuccessPage'), 'OrderSuccessPage')
const InvoicePage = lazyNamed(() => import('@/pages/customer/InvoicePage'), 'InvoicePage')
const ContactPage = lazyNamed(() => import('@/pages/customer/ContactPage'), 'ContactPage')
const FaqPage = lazyNamed(() => import('@/pages/customer/FaqPage'), 'FaqPage')
const SupportPage = lazyNamed(() => import('@/pages/customer/SupportPage'), 'SupportPage')

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

/** Guarded admin page: no session → login, missing permission → 403. */
const guarded = (Component: ComponentType, title: string, permission: Permission) => (
  <RequireAdmin permission={permission}>{titled(Component, title)}</RequireAdmin>
)

export const router = createBrowserRouter([
  {
    element: <CustomerLayout />,
    children: [
      { path: '/', element: titled(HomePage, 'Home · Vedhi Foods') },
      { path: '/about', element: titled(AboutPage, 'Our story · Vedhi Foods') },
      { path: '/shop', element: titled(ShopPage, 'Shop · Vedhi Foods') },
      { path: '/categories', element: titled(CategoriesPage, 'Categories · Vedhi Foods') },
      { path: '/product/:slug', element: titled(ProductDetailPage, 'Product · Vedhi Foods') },
      { path: '/cart', element: titled(CartPage, 'Cart · Vedhi Foods') },
      { path: '/checkout', element: titled(CheckoutPage, 'Checkout · Vedhi Foods') },
      { path: '/order-success/:orderNumber', element: titled(OrderSuccessPage, 'Order confirmed · Vedhi Foods') },
      { path: '/invoice/:id', element: titled(InvoicePage, 'Invoice · Vedhi Foods') },
      { path: '/contact', element: titled(ContactPage, 'Contact · Vedhi Foods') },
      { path: '/faq', element: titled(FaqPage, 'FAQ · Vedhi Foods') },
      { path: '/support', element: titled(SupportPage, 'Support · Vedhi Foods') },
      { path: '*', element: titled(NotFoundPage, 'Not found · Vedhi Foods') },
    ],
  },
  {
    path: '/admin/login',
    element: titled(AdminLoginPage, 'Admin sign in · Vedhi Foods'),
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <RequireAdmin>{titled(AdminDashboardPage, 'Dashboard · Vedhi Admin')}</RequireAdmin> },
      { path: 'products', element: guarded(AdminProductsPage, 'Products · Vedhi Admin', 'products:read') },
      { path: 'products/compare', element: guarded(AdminProductsPage, 'Products · Vedhi Admin', 'products:read') },
      { path: 'products/archive', element: guarded(AdminProductsPage, 'Products · Vedhi Admin', 'products:read') },
      { path: 'inventory', element: guarded(AdminInventoryPage, 'Inventory · Vedhi Admin', 'inventory:read') },
      { path: 'orders', element: guarded(AdminOrdersPage, 'Orders · Vedhi Admin', 'orders:read') },
      { path: 'orders/:id', element: guarded(AdminOrdersPage, 'Order detail · Vedhi Admin', 'orders:read') },
      { path: 'customers', element: guarded(AdminCustomersPage, 'Customers · Vedhi Admin', 'customers:read') },
      { path: 'customers/:id', element: guarded(AdminCustomerDetailPage, 'Customer · Vedhi Admin', 'customers:read') },
      { path: 'delivery', element: guarded(AdminDeliveryPage, 'Delivery · Vedhi Admin', 'delivery:read') },
      { path: 'invoices', element: guarded(AdminInvoicesPage, 'Invoices · Vedhi Admin', 'invoices:read') },
      { path: 'discounts', element: guarded(AdminDiscountsPage, 'Discounts · Vedhi Admin', 'discounts:read') },
      { path: 'promotions', element: guarded(AdminPromotionsPage, 'Festival Promotions · Vedhi Admin', 'promotions:read') },
      { path: 'support', element: guarded(AdminSupportPage, 'Customer Support · Vedhi Admin', 'support:read') },
      { path: 'support/:id', element: guarded(AdminTicketDetailPage, 'Ticket · Vedhi Admin', 'support:read') },
      { path: 'staff', element: guarded(AdminStaffPage, 'Staff Management · Vedhi Admin', 'staff:read') },
      { path: 'staff/new', element: guarded(AdminStaffPage, 'Invite Staff · Vedhi Admin', 'staff:write') },
      { path: 'staff/:id', element: guarded(AdminStaffPage, 'Edit Staff · Vedhi Admin', 'staff:write') },
      { path: 'permissions', element: guarded(AdminPermissionsPage, 'Permissions · Vedhi Admin', 'staff:read') },
      { path: 'audit-logs', element: guarded(AdminAuditLogsPage, 'Audit Logs · Vedhi Admin', 'audit:read') },
      { path: 'settings', element: guarded(AdminSettingsPage, 'Website Settings · Vedhi Admin', 'settings:read') },
      { path: 'payment-settings', element: guarded(AdminPaymentSettingsPage, 'Payment Settings · Vedhi Admin', 'payments:read') },
      { path: 'security', element: guarded(AdminSecurityPage, 'Security · Vedhi Admin', 'security:write') },
      { path: 'theme', element: guarded(AdminThemePage, 'Branding · Vedhi Admin', 'settings:read') },
      { path: 'contact-settings', element: guarded(AdminContactSettingsPage, 'Contact Details · Vedhi Admin', 'settings:read') },
      { path: '*', element: titled(NotFoundPage, 'Not found · Vedhi Admin') },
    ],
  },
])