import type { ID, StatusTone } from './common'
import type { Address } from './commerce'

/* -------------------------------------------------------------- Customers */

export type CustomerStatus = 'active' | 'inactive' | 'blocked'

export interface Customer {
  id: ID
  name: string
  email: string
  phone: string
  status: CustomerStatus
  addresses: Address[]
  orderCount: number
  totalSpent: number
  marketingOptIn: boolean
  joinedAt: string
  lastOrderAt?: string
}

export interface CustomerSession {
  id: ID
  name: string
  email: string
  role: RoleName
  token: string
}

/* ------------------------------------------------------------------ Staff */

/**
 * Roles mirrored from the database `enum RoleName { OWNER ADMIN STAFF CUSTOMER }`.
 *
 * This was `'owner' | 'admin' | 'manager' | 'inventory' | 'support' | 'viewer'`,
 * none of which existed server-side. It typechecked only because no client code
 * ever fed an API role back into it — `adminAuthService.toRoleName()` returned
 * `'staff'`/`'customer'` and was rejected the moment the console was actually
 * typechecked. Anything building `Role`-shaped objects was describing roles the
 * API cannot store.
 */
export type RoleName = 'owner' | 'admin' | 'staff' | 'customer'

/**
 * Permission slugs, in the exact vocabulary the backend enforces.
 *
 * SECURITY / CORRECTNESS: this union previously used a colon-separated,
 * read/write-collapsed scheme (`products:read`, `products:write`, `audit:read`)
 * that exists nowhere else in the system. `requirePermission` in
 * `backend/src/middleware/auth.middleware.ts` compares against raw `Permission.slug`
 * values seeded by `database/seed.ts`, which are dot-separated and distinguish
 * create/update/delete (`products.read`, `products.update`, `audit_logs.read`).
 *
 * `adminAuthService.toPermissions()` cast the server's response straight to this
 * type without translating, and `can()` did a literal `includes()`. Because
 * `products.read` can never equal `products:read`, every check returned false for
 * every role, and the deliberate removal of the old `isOwner` bypass meant there
 * was no longer a way in: the console hid its whole navigation and redirected
 * every guarded route to the login screen for the owner as well as for staff.
 *
 * These are now the exact slugs the API requires, so a control is shown exactly
 * when the corresponding endpoint would let the caller through. Two consequences
 * worth knowing when reading the nav:
 *
 *   - There is no `write` slug. Reads and mutations are separate grants, and the
 *     nav gates a page on its *read* grant because that is what decides whether
 *     the page can load at all.
 *   - Promotions are gated by `discounts.*` and payment settings by `settings.*`,
 *     because that is what `discount.routes.ts` and `admin.routes.ts` enforce.
 *     A `promotions.*` or `payments.*` slug would pass the UI check and then be
 *     refused by the API.
 */
export type Permission =
  | 'products.read'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  | 'categories.read'
  | 'categories.create'
  | 'categories.update'
  | 'categories.delete'
  | 'inventory.read'
  | 'inventory.update'
  | 'orders.read'
  | 'orders.update'
  | 'orders.cancel'
  | 'customers.read'
  | 'customers.update'
  | 'delivery.read'
  | 'delivery.update'
  | 'delivery.assign'
  | 'invoices.read'
  | 'invoices.create'
  | 'discounts.read'
  | 'discounts.create'
  | 'discounts.update'
  | 'discounts.delete'
  | 'support.read'
  | 'support.reply'
  | 'support.update'
  | 'support.assign'
  | 'support.close'
  | 'contacts.read'
  | 'contacts.manage'
  | 'settings.read'
  | 'settings.update'
  | 'staff.read'
  | 'staff.create'
  | 'staff.update'
  | 'staff.delete'
  | 'reports.read'
  | 'audit_logs.read'

  | 'content.read'
  | 'content.update'

export interface Role {
  name: RoleName
  label: string
  description: string
  permissions: Permission[]
  system: boolean
}

export type StaffStatus = 'active' | 'invited' | 'suspended'

export interface StaffMember {
  id: ID
  name: string
  email: string
  phone: string
  role: RoleName
  status: StaffStatus
  /** Role name label override (freeform future custom roles). */
  title?: string
  /** Granular permission overrides. When empty, `role.permissions` applies. */
  permissions?: Permission[]
  employeeId?: string
  createdAt: string
  lastActiveAt?: string
  /** Prototype only — never store plain-text passwords in production. */
  passwordHint?: string
}

/* -------------------------------------------------------- Support tickets */

export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketCategory =
  | 'order'
  | 'delivery'
  | 'product'
  | 'payment'
  | 'returns'
  | 'website'
  | 'other'

export interface TicketReply {
  authorName: string
  content: string
  at: string
}

export interface SupportTicket {
  id: ID
  ticketNumber: string
  customerName: string
  customerEmail: string
  subject: string
  message: string
  replies?: TicketReply[]
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  createdAt: string
  updatedAt: string
  assigneeId?: ID
  assigneeName?: string
}

/* ------------------------------------------------------------- Audit logs */

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'export' | 'settings'

export interface AuditLog {
  id: ID
  actor: string
  /** Not carried by the backend audit rows — page renders without it. */
  actorRole?: RoleName
  action: AuditAction
  entity: string
  entityId?: ID
  summary: string
  ipAddress: string
  tone: StatusTone
  createdAt: string
}

/* ------------------------------------------------------- Website settings */

export interface WebsiteSettings {
  brandName: string
  tagline: string
  supportEmail: string
  supportPhone: string
  whatsapp: string
  addressLine: string
  city: string
  state: string
  pincode: string
  currency: 'INR'
  gstin: string
  freeShippingThreshold: number
  standardShippingFee: number
  taxRate: number
  announcement: string
  announcementActive: boolean
  socials: SocialLink[]
  businessHours: string
  /** Homepage hero headline (rendered before the accent phrase). */
  heroTitle: string
  /** Accent phrase appended to the hero headline. */
  heroTitleAccent: string
  /** Hero supporting paragraph. */
  heroSubtitle: string
  /** Hero primary call-to-action label. */
  heroCtaLabel: string
  /** Hero background images (URLs or data URLs), cross-faded in order. */
  heroImages: string[]
  /** Whether the homepage "Our Story" milestones section is shown. */
  storyEnabled: boolean
}

export interface SocialLink {
  platform: 'instagram' | 'facebook' | 'youtube' | 'x' | 'linkedin'
  label: string
  href: string
}

/* ------------------------------------------------ Brand / Theme settings */

export interface BrandSettings {
  logoUrl?: string
  logoName?: string
  themePreset: string
  primary: string
  secondary: string
  accent: string
  background: string
}

/* -------------------------------------------------- Admin dashboard stats */

export interface DashboardMetric {
  id: string
  label: string
  value: string
  delta: number
  trend: 'up' | 'down' | 'flat'
  hint: string
  tone: StatusTone
}

export interface RevenuePoint {
  label: string
  revenue: number
  orders: number
}

export interface TopProduct {
  productId: ID
  name: string
  image: string
  unitsSold: number
  revenue: number
}

/** Low-stock product row surfaced on the inventory reorder list. */
export interface InventoryAlert {
  productId: ID
  name: string
  sku: string
  image: string
  stock: number
  reorderLevel: number
}
