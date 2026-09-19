import {
  DASHBOARD_METRICS,
  INVENTORY_ALERTS,
  ORDER_STATUS_BREAKDOWN,
  REVENUE_SERIES,
  TOP_PRODUCTS,
} from '@/data/admin'
import { adminStore, type AdminStore, type AuditInput } from './adminStore'
import { adminAuthService } from './adminAuthService'
import { mockRequest, type RequestOptions } from './http'
import type {
  AuditLog,
  BrandSettings,
  Customer,
  DashboardMetric,
  Delivery,
  Discount,
  Invoice,
  Order,
  PaymentGatewaySettings,
  Product,
  Promotion,
  RevenuePoint,
  Role,
  StaffMember,
  SupportTicket,
  TopProduct,
} from '@/types'
import { STORAGE_KEYS } from '../config/site'
import { storage } from '../utils/storage'

function actor(): Pick<AuditInput, 'actor' | 'actorRole'> {
  const session = adminAuthService.session()
  return {
    actor: session?.name ?? 'System',
    actorRole: session?.role ?? 'viewer',
  }
}

/**
 * Admin API — the UI only ever talks to this service. Underneath it persists
 * to a localStorage store (same REST contract the backend will eventually
 * expose); every write is audit-logged.
 */
export const adminService = {
  /* ------------------------------------------------------------ Dashboard */
  async dashboard(options?: RequestOptions) {
    return mockRequest(
      () => {
        const report = adminStore.read()
        return {
          metrics: DASHBOARD_METRICS,
          revenueSeries: REVENUE_SERIES,
          topProducts: TOP_PRODUCTS.slice(0, 5),
          recentOrders: report.orders.slice(0, 8),
          recentCustomers: adminStore.customers().slice(0, 4),
          orderStatusBreakdown: ORDER_STATUS_BREAKDOWN,
        }
      },
      { delay: 220, ...options },
    )
  },

  async dashboardMetrics(options?: RequestOptions): Promise<DashboardMetric[]> {
    return mockRequest(() => DASHBOARD_METRICS, { delay: 180, ...options })
  },

  async revenueSeries(options?: RequestOptions): Promise<RevenuePoint[]> {
    return mockRequest(() => REVENUE_SERIES, { delay: 180, ...options })
  },

  async topProducts(limit = 8, options?: RequestOptions): Promise<TopProduct[]> {
    return mockRequest(() => TOP_PRODUCTS.slice(0, limit), { delay: 180, ...options })
  },

  async orderStatusBreakdown(options?: RequestOptions) {
    return mockRequest(() => ORDER_STATUS_BREAKDOWN, { delay: 140, ...options })
  },

  async inventoryAlerts(options?: RequestOptions) {
    return mockRequest(() => INVENTORY_ALERTS, { delay: 180, ...options })
  },

  /* ---------------------------------------------------------------- Reads */
  async customers(options?: RequestOptions): Promise<Customer[]> {
    return mockRequest(() => adminStore.customers(), { delay: 200, ...options })
  },

  async customer(id: string, options?: RequestOptions): Promise<Customer | undefined> {
    return mockRequest(() => adminStore.customers().find((customer) => customer.id === id), { delay: 160, ...options })
  },

  async orders(options?: RequestOptions): Promise<Order[]> {
    return mockRequest(() => adminStore.orders(), { delay: 200, ...options })
  },

  async order(id: string, options?: RequestOptions): Promise<Order | undefined> {
    return mockRequest(() => adminStore.orders().find((order) => order.id === id), { delay: 140, ...options })
  },

  async invoices(options?: RequestOptions): Promise<Invoice[]> {
    return mockRequest(() => adminStore.invoices(), { delay: 200, ...options })
  },

  async deliveries(options?: RequestOptions): Promise<Delivery[]> {
    return mockRequest(() => adminStore.deliveries(), { delay: 200, ...options })
  },

  async deliveryPartners(options?: RequestOptions) {
    return mockRequest(() => adminStore.deliveryPartners(), { delay: 160, ...options })
  },

  async discounts(options?: RequestOptions): Promise<Discount[]> {
    return mockRequest(() => adminStore.discounts(), { delay: 180, ...options })
  },

  async promotions(options?: RequestOptions): Promise<Promotion[]> {
    return mockRequest(() => adminStore.promotions(), { delay: 180, ...options })
  },

  async products(options?: RequestOptions): Promise<Product[]> {
    return mockRequest(() => adminStore.products(), { delay: 200, ...options })
  },

  async product(id: string, options?: RequestOptions): Promise<Product | undefined> {
    return mockRequest(() => adminStore.products().find((product) => product.id === id), { delay: 140, ...options })
  },

  async tickets(options?: RequestOptions): Promise<SupportTicket[]> {
    return mockRequest(() => adminStore.tickets(), { delay: 200, ...options })
  },

  async roles(options?: RequestOptions): Promise<Role[]> {
    return mockRequest(() => adminStore.roles(), { delay: 140, ...options })
  },

  async staff(options?: RequestOptions): Promise<StaffMember[]> {
    return mockRequest(() => adminStore.staff(), { delay: 180, ...options })
  },

  async auditLogs(options?: RequestOptions): Promise<AuditLog[]> {
    return mockRequest(() => adminStore.auditLogs(), { delay: 200, ...options })
  },

  async paymentGateway(options?: RequestOptions): Promise<PaymentGatewaySettings> {
    return mockRequest(() => adminStore.paymentGateway(), { delay: 140, ...options })
  },

  async brand(options?: RequestOptions): Promise<BrandSettings> {
    return mockRequest(() => adminStore.brand(), { delay: 140, ...options })
  },

  /* ---------------------------------------------------------------- Writes */
  async createProduct(input: Omit<Product, 'id' | 'createdAt'> & { id?: string }, options?: RequestOptions) {
    return mockRequest(() => {
      const product: Product = { ...input, id: input.id ?? `prd-${Date.now().toString(36)}`, createdAt: new Date().toISOString() }
      adminStore.update('products', (products) => [...products, product], {
        ...actor(),
        action: 'create',
        entity: 'Product',
        entityId: product.id,
        summary: `Created product “${product.name}”`,
        tone: 'success',
      })
      return product
    }, { delay: 360, ...options })
  },

  async updateProduct(id: string, patch: Partial<Product>, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('products', (products) => products.map((product) => (product.id === id ? { ...product, ...patch } : product)), {
        ...actor(),
        action: 'update',
        entity: 'Product',
        entityId: id,
        summary: `Updated product ${patch.name ? `“${patch.name}”` : id}`,
        tone: 'info',
      })
      return adminStore.products().find((product) => product.id === id)
    }, { delay: 320, ...options })
  },

  async deleteProduct(id: string, options?: RequestOptions) {
    return mockRequest(() => {
      const product = adminStore.products().find((candidate) => candidate.id === id)
      adminStore.update('products', (products) => products.filter((candidate) => candidate.id !== id), {
        ...actor(),
        action: 'delete',
        entity: 'Product',
        entityId: id,
        summary: `Deleted product ${product ? `“${product.name}”` : id}`,
        tone: 'danger',
      })
    }, { delay: 300, ...options })
  },

  /* -------------------------------------------------------------- Orders */
  async updateOrderStatus(id: string, status: Order['status'], options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('orders', (orders) =>
        orders.map((order) =>
          order.id === id
            ? {
                ...order,
                status,
                timeline: [
                  ...(order.timeline ?? []),
                  { label: toStatusLabel(status), at: new Date().toISOString(), status, completed: true },
                ],
              }
            : order,
        ),
        {
          ...actor(),
          action: 'update',
          entity: 'Order',
          entityId: id,
          summary: `Order ${id} → ${status.replace('-', ' ')}`,
          tone: 'info',
        },
      )
    }, { delay: 260, ...options })
  },

  /* ----------------------------------------------------------- Deliveries */
  async updateDelivery(id: string, patch: Partial<Delivery>, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('deliveries', (deliveries) => deliveries.map((delivery) => (delivery.id === id ? { ...delivery, ...patch } : delivery)), {
        ...actor(),
        action: 'update',
        entity: 'Delivery',
        entityId: id,
        summary: `Updated delivery ${id}`,
        tone: 'info',
      })
    }, { delay: 260, ...options })
  },

  /* ----------------------------------------------------------- Discounts */
  async createDiscount(input: Omit<Discount, 'id'>, options?: RequestOptions) {
    return mockRequest(() => {
      const discount: Discount = { ...input, id: `dc-${Date.now().toString(36)}` }
      adminStore.update('discounts', (discounts) => [discount, ...discounts], {
        ...actor(),
        action: 'create',
        entity: 'Discount',
        entityId: discount.id,
        summary: `Created discount ${discount.code ? `“${discount.code}”` : discount.id}`,
        tone: 'success',
      })
      return discount
    }, { delay: 320, ...options })
  },

  async updateDiscount(id: string, patch: Partial<Discount>, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('discounts', (discounts) => discounts.map((discount) => (discount.id === id ? { ...discount, ...patch } : discount)), {
        ...actor(),
        action: 'update',
        entity: 'Discount',
        entityId: id,
        summary: 'Updated discount',
        tone: 'info',
      })
    }, { delay: 280, ...options })
  },

  async deleteDiscount(id: string, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('discounts', (discounts) => discounts.filter((discount) => discount.id !== id), {
        ...actor(),
        action: 'delete',
        entity: 'Discount',
        entityId: id,
        summary: 'Deleted discount',
        tone: 'danger',
      })
    }, { delay: 260, ...options })
  },

  /* ---------------------------------------------------------- Promotions */
  async createPromotion(input: Omit<Promotion, 'id'>, options?: RequestOptions) {
    return mockRequest(() => {
      const promotion: Promotion = { ...input, id: `pro-${Date.now().toString(36)}` }
      adminStore.update('promotions', (promotions) => [promotion, ...promotions], {
        ...actor(),
        action: 'create',
        entity: 'Promotion',
        entityId: promotion.id,
        summary: `Created promotion “${promotion.title}”`,
        tone: 'success',
      })
      return promotion
    }, { delay: 320, ...options })
  },

  async updatePromotion(id: string, patch: Partial<Promotion>, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('promotions', (promotions) => promotions.map((promotion) => (promotion.id === id ? { ...promotion, ...patch } : promotion)), {
        ...actor(),
        action: 'update',
        entity: 'Promotion',
        entityId: id,
        summary: `Updated promotion “${patch.title ?? id}”`,
        tone: 'info',
      })
    }, { delay: 280, ...options })
  },

  async deletePromotion(id: string, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('promotions', (promotions) => promotions.filter((promotion) => promotion.id !== id), {
        ...actor(),
        action: 'delete',
        entity: 'Promotion',
        entityId: id,
        summary: 'Deleted promotion',
        tone: 'danger',
      })
    }, { delay: 260, ...options })
  },

  /* -------------------------------------------------------------- Staff */
  async createStaff(input: Omit<StaffMember, 'id'> & { id?: string }, options?: RequestOptions) {
    return mockRequest(() => {
      const member: StaffMember = { ...input, id: input.id ?? `stf-${Date.now().toString(36)}` }
      adminStore.update('staff', (staff) => [...staff, member], {
        ...actor(),
        action: 'create',
        entity: 'Staff member',
        entityId: member.id,
        summary: `Invited ${member.name} as ${member.role}`,
        tone: 'success',
      })
      return member
    }, { delay: 340, ...options })
  },

  async updateStaff(id: string, patch: Partial<StaffMember>, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('staff', (staff) => staff.map((member) => (member.id === id ? { ...member, ...patch } : member)), {
        ...actor(),
        action: 'update',
        entity: 'Staff member',
        entityId: id,
        summary: `Updated ${patch.name ?? id}${patch.role ? ` → ${patch.role}` : ''}`,
        tone: 'info',
      })
    }, { delay: 300, ...options })
  },

  async deleteStaff(id: string, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('staff', (staff) => staff.filter((member) => member.id !== id), {
        ...actor(),
        action: 'delete',
        entity: 'Staff member',
        entityId: id,
        summary: 'Removed staff member',
        tone: 'danger',
      })
    }, { delay: 280, ...options })
  },

  /* --------------------------------------------------- Payment + branding */
  async savePaymentGateway(patch: Partial<PaymentGatewaySettings>, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('paymentGateway', (gateway) => ({ ...gateway, ...patch }), {
        ...actor(),
        action: 'update',
        entity: 'Payment settings',
        summary: 'Updated payment gateway settings',
        tone: 'info',
      })
    }, { delay: 300, ...options })
  },

  async saveBrand(patch: Partial<BrandSettings>, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('brand', (brand) => ({ ...brand, ...patch }), {
        ...actor(),
        action: 'update',
        entity: 'Brand settings',
        summary: 'Updated logo / theme branding',
        tone: 'info',
      })
    }, { delay: 300, ...options })
  },

  /* ----------------------------------------------------------- Tickets */
  async updateTicketStatus(id: string, status: SupportTicket['status'], options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('tickets', (tickets) =>
        tickets.map((ticket) =>
          ticket.id === id
            ? { ...ticket, status, updatedAt: new Date().toISOString() }
            : ticket,
        ),
        {
          ...actor(),
          action: 'update',
          entity: 'Support ticket',
          entityId: id,
          summary: `Ticket ${id} → ${status}`,
          tone: 'info',
        },
      )
    }, { delay: 240, ...options })
  },

  async updateTicketAssignee(id: string, assigneeId: string | undefined, assigneeName: string | undefined, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('tickets', (tickets) =>
        tickets.map((ticket) =>
          ticket.id === id
            ? { ...ticket, assigneeId, assigneeName, updatedAt: new Date().toISOString() }
            : ticket,
        ),
        {
          ...actor(),
          action: 'update',
          entity: 'Support ticket',
          entityId: id,
          summary: `Assigned ${id} to ${assigneeName ?? 'no one'}`,
          tone: 'info',
        },
      )
    }, { delay: 220, ...options })
  },

  async replyTicket(id: string, content: string, options?: RequestOptions) {
    return mockRequest(() => {
      adminStore.update('tickets', (tickets) =>
        tickets.map((ticket) =>
          ticket.id === id
            ? {
                ...ticket,
                status: ticket.status === 'open' ? 'in-progress' : ticket.status,
                updatedAt: new Date().toISOString(),
                replies: [
                  ...(ticket.replies ?? []),
                  { authorName: actor().actor, content, at: new Date().toISOString() },
                ],
              }
            : ticket,
        ),
        {
          ...actor(),
          action: 'update',
          entity: 'Support ticket',
          entityId: id,
          summary: `Replied to ticket ${id}`,
          tone: 'info',
        },
      )
    }, { delay: 320, ...options })
  },

  /* -------------------------------------------------------------- Reset */
  /** Restores the seeded demo dataset (handy for QA and owner re-demo). */
  resetData(options?: RequestOptions) {
    return mockRequest(() => {
      storage.remove(STORAGE_KEYS.adminData)
      adminStore.log({
        ...actor(),
        action: 'update',
        entity: 'Database',
        summary: 'Demo data reset to seed',
        tone: 'info',
      })
    }, { delay: 400, ...options })
  },

  /** Low-level typed access for pages that need cross-entity reads. */
  snapshot(): AdminStore {
    return adminStore.read()
  },
}

function toStatusLabel(status: string): string {
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}