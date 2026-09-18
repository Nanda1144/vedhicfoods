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

export type RoleName = 'owner' | 'admin' | 'manager' | 'inventory' | 'support' | 'viewer'

export type Permission =
  | 'products:read'
  | 'products:write'
  | 'categories:read'
  | 'categories:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'orders:read'
  | 'orders:write'
  | 'customers:read'
  | 'customers:write'
  | 'delivery:read'
  | 'delivery:write'
  | 'invoices:read'
  | 'invoices:write'
  | 'discounts:read'
  | 'discounts:write'
  | 'promotions:read'
  | 'promotions:write'
  | 'payments:read'
  | 'payments:write'
  | 'support:read'
  | 'support:write'
  | 'settings:read'
  | 'settings:write'
  | 'theme:write'
  | 'logo:write'
  | 'contact:write'
  | 'staff:read'
  | 'staff:write'
  | 'audit:read'
  | 'security:write'

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
  actorRole: RoleName
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
