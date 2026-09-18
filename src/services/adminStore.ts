import { PRODUCTS } from '@/data/products'
import {
  AUDIT_LOGS,
  CUSTOMERS,
  DELIVERIES,
  DELIVERY_PARTNERS,
  DISCOUNTS,
  INVOICES,
  ORDERS,
  PROMOTIONS,
  ROLES as adminRolesSeed,
  STAFF,
  SUPPORT_TICKETS,
} from '@/data/admin'
import { STORAGE_KEYS } from '@/config/site'
import { storage } from '@/utils/storage'
import type {
  AuditLog,
  BrandSettings,
  Customer,
  Delivery,
  DeliveryPartner,
  Discount,
  Invoice,
  Order,
  PaymentGatewaySettings,
  Product,
  Promotion,
  Role,
  StaffMember,
  SupportTicket,
} from '@/types'
import { DEFAULT_BRAND, DEFAULT_PAYMENT_GATEWAY } from '../config/adminDefaults'

/**
 * Local-first admin "database".
 *
 * Mirrors the future data model: Admin · User · Role · Permission · Product ·
 * Category · Inventory · Discount · Promotion · Order · Customer · Invoice ·
 * Delivery · SupportTicket · WebsiteSettings · PaymentSettings · AuditLog.
 *
 * Every mutation persists under a single localStorage key and appends an audit
 * log entry, so the owner demo (staff CRUD → permissions → login → audit trail)
 * behaves exactly like a real backend would. Swap each accessor for an API call
 * later — nothing in the UI touches storage directly.
 */

export interface AdminStore {
  staff: StaffMember[]
  orders: Order[]
  deliveries: Delivery[]
  discounts: Discount[]
  promotions: Promotion[]
  products: Product[]
  tickets: SupportTicket[]
  auditLogs: AuditLog[]
  paymentGateway: PaymentGatewaySettings
  brand: BrandSettings
}

export interface AuditInput {
  actor: string
  actorRole: Role['name']
  action: AuditLog['action']
  entity: string
  entityId?: string
  summary: string
  tone?: AuditLog['tone']
}

function seed(): AdminStore {
  return {
    staff: structuredClone(STAFF),
    orders: structuredClone(ORDERS),
    deliveries: structuredClone(DELIVERIES),
    discounts: structuredClone(DISCOUNTS),
    promotions: structuredClone(PROMOTIONS),
    products: structuredClone(PRODUCTS),
    tickets: structuredClone(SUPPORT_TICKETS),
    auditLogs: structuredClone(AUDIT_LOGS),
    paymentGateway: structuredClone(DEFAULT_PAYMENT_GATEWAY),
    brand: structuredClone(DEFAULT_BRAND),
  }
}

function readStore(): AdminStore {
  const stored = storage.get<Partial<AdminStore> | null>(STORAGE_KEYS.adminData, null)
  const base = seed()
  if (!stored || typeof stored !== 'object') return base
  return {
    ...base,
    ...stored,
    brand: { ...base.brand, ...(stored.brand ?? {}) },
    paymentGateway: { ...base.paymentGateway, ...(stored.paymentGateway ?? {}) },
  }
}

function writeStore(store: AdminStore): void {
  storage.set(STORAGE_KEYS.adminData, store)
}

function buildAudit(input: AuditInput, actorRole?: Role['name']): AuditLog {
  return {
    id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    actor: input.actor,
    actorRole: input.actorRole ?? actorRole ?? 'owner',
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    summary: input.summary,
    ipAddress: '127.0.0.1',
    tone: input.tone ?? 'info',
    createdAt: new Date().toISOString(),
  }
}

/** Server-side constants the admin UI reads but never edits. */
export const adminConstants = {
  deliveryPartners: DELIVERY_PARTNERS,
}

export const adminStore = {
  read(): AdminStore {
    return readStore()
  },

  /** Applies `mutate`, persists and returns the typed slice. Never mutates seeds. */
  update<T extends keyof AdminStore>(
    key: T,
    mutate: (slice: AdminStore[T]) => AdminStore[T] | void,
    audit: AuditInput,
  ): AdminStore[T] {
    const store = readStore()
    const current = store[key]
    const next = mutate(current)
    if (next !== undefined) store[key] = next
    store.auditLogs.unshift(buildAudit(audit))
    writeStore(store)
    return store[key]
  },

  log(audit: AuditInput): AuditLog {
    const store = readStore()
    const entry = buildAudit(audit)
    store.auditLogs.unshift(entry)
    writeStore(store)
    return entry
  },

  /* ------------------------------------------------------- Entity accessors */
  staff(): StaffMember[] {
    return readStore().staff
  },

  roles(): Role[] {
    return [...adminRolesSeed]
  },

  customers(): Customer[] {
    return structuredClone(CUSTOMERS)
  },

  orders(): Order[] {
    return readStore().orders
  },

  invoices(): Invoice[] {
    return structuredClone(INVOICES)
  },

  deliveries(): Delivery[] {
    return readStore().deliveries
  },

  deliveryPartners(): DeliveryPartner[] {
    return adminConstants.deliveryPartners
  },

  discounts(): Discount[] {
    return readStore().discounts
  },

  promotions(): Promotion[] {
    return readStore().promotions
  },

  products(): Product[] {
    return readStore().products
  },

  tickets(): SupportTicket[] {
    return readStore().tickets
  },

  auditLogs(): AuditLog[] {
    return readStore().auditLogs
  },

  paymentGateway(): PaymentGatewaySettings {
    return readStore().paymentGateway
  },

  brand(): BrandSettings {
    return readStore().brand
  },
}