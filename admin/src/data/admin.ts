import type { Permission } from '@/types'

/**
 * Display order for the permission matrix / pickers. Must stay a superset-equal
 * of the slugs seeded by `database/seed.ts` and enforced by `requirePermission`,
 * otherwise the UI silently omits grants the API supports. Keep in sync with the
 * `Permission` union.
 */
export const PERMISSIONS: Permission[] = [
  'products.read', 'products.create', 'products.update', 'products.delete',
  'categories.read', 'categories.create', 'categories.update', 'categories.delete',
  'inventory.read', 'inventory.update',
  'orders.read', 'orders.update', 'orders.cancel',
  'customers.read', 'customers.update',
  'delivery.read', 'delivery.update', 'delivery.assign',
  'invoices.read', 'invoices.create',
  'discounts.read', 'discounts.create', 'discounts.update', 'discounts.delete',
  'support.read', 'support.reply', 'support.update', 'support.assign', 'support.close',
  'contacts.read', 'contacts.manage',
  'settings.read', 'settings.update',
  'staff.read', 'staff.create', 'staff.update', 'staff.delete',
  'reports.read',
  'audit_logs.read',
  'content.read', 'content.update',
]

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Renders a permission slug for humans: `audit_logs.read` -> `Audit Logs · Read`.
 *
 * Splitting on `.` matters: an unexpected slug degrades to its own text rather
 * than rendering "undefined".
 */
export function permissionLabel(permission: Permission): string {
  const [module, action] = permission.split('.')
  if (!action) return titleCase(module)
  return `${titleCase(module)} · ${titleCase(action)}`
}
