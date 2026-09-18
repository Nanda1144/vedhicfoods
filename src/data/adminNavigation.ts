import type { IconName } from '@/components/common'
import type { Permission } from '@/types'

export interface AdminNavItem {
  label: string
  href: string
  icon: IconName
  /** Route-level read permission; sidebar + guard both use it. */
  permission?: Permission
  end?: boolean
}

export interface AdminNavSection {
  title: string
  items: AdminNavItem[]
}

export const ADMIN_NAV: AdminNavSection[] = [
  {
    title: 'Dashboard',
    items: [{ label: 'Dashboard', href: '/admin', icon: 'home', end: true }],
  },
  {
    title: 'Commerce',
    items: [
      { label: 'Products', href: '/admin/products', icon: 'box', permission: 'products:read' },
      { label: 'Categories', href: '/admin/products?view=categories', icon: 'tag', permission: 'categories:read' },
      { label: 'Inventory', href: '/admin/inventory', icon: 'package-open', permission: 'inventory:read' },
      { label: 'Orders', href: '/admin/orders', icon: 'cart', permission: 'orders:read' },
      { label: 'Customers', href: '/admin/customers', icon: 'users', permission: 'customers:read' },
      { label: 'Delivery', href: '/admin/delivery', icon: 'truck', permission: 'delivery:read' },
      { label: 'Invoices', href: '/admin/invoices', icon: 'download', permission: 'invoices:read' },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { label: 'Discounts', href: '/admin/discounts', icon: 'tag', permission: 'discounts:read' },
      { label: 'Festival Promotions', href: '/admin/promotions', icon: 'sparkles', permission: 'promotions:read' },
    ],
  },
  {
    title: 'Support',
    items: [{ label: 'Customer Support', href: '/admin/support', icon: 'mail', permission: 'support:read' }],
  },
  {
    title: 'Website',
    items: [
      { label: 'Logo', href: '/admin/theme#logo', icon: 'store', permission: 'settings:read' },
      { label: 'Theme', href: '/admin/theme#theme', icon: 'sliders', permission: 'settings:read' },
      { label: 'Contact Details', href: '/admin/contact-settings', icon: 'phone', permission: 'settings:read' },
      { label: 'Website Settings', href: '/admin/settings', icon: 'edit', permission: 'settings:read' },
    ],
  },
  {
    title: 'Payments',
    items: [
      { label: 'Payment Settings', href: '/admin/payment-settings', icon: 'wallet', permission: 'payments:read' },
    ],
  },
  {
    title: 'Staff',
    items: [
      { label: 'Staff Management', href: '/admin/staff', icon: 'users', permission: 'staff:read' },
      { label: 'Permissions', href: '/admin/permissions', icon: 'shield', permission: 'staff:read' },
    ],
  },
  {
    title: 'Security',
    items: [
      { label: 'Change Password', href: '/admin/security', icon: 'lock', permission: 'security:write' },
      { label: 'Audit Logs', href: '/admin/audit-logs', icon: 'clock', permission: 'audit:read' },
    ],
  },
]