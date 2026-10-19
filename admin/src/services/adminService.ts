import { apiFetchRaw, type RequestOptions } from './http'
import type {
  Address,
  AuditAction,
  AuditLog,
  BrandSettings,
  Category,
  Customer,
  DashboardMetric,
  Delivery,
  DeliveryPartner,
  DeliveryStatus,
  Discount,
  Invoice,
  InventoryAlert,
  Order,
  OrderLineItem,
  OrderStatus,
  OrderTimelineEntry,
  PaymentGatewaySettings,
  Product,
  Promotion,
  RevenuePoint,
  Role,
  RoleName,
  StaffMember,
  StatusTone,
  SupportTicket,
  TicketPriority,
  TicketStatus,
  TopProduct,
} from '@/types'

/* ------------------------------------------------------------- HTTP utils */

const PAGE_SIZE = 100
const MAX_PAGES = 10

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value)
}

function bool(value: unknown): boolean {
  return Boolean(value)
}

function iso(value: unknown): string | undefined {
  if (value == null) return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Fetches every page of a list endpoint and concatenates the items. */
export async function fetchAll<T>(
  path: string,
  options?: RequestOptions,
  extract: (body: any) => T[] | undefined = extractItems,
): Promise<T[]> {
  const collected: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = `?page=${page}&limit=${PAGE_SIZE}&per_page=${PAGE_SIZE}`
    const body = await apiFetchRaw<any>(`${path}${query}`, undefined, options)
    const items = extract(body)
    if (!items || items.length === 0) break
    collected.push(...items)
    if (items.length < PAGE_SIZE) break
  }
  return collected
}

function extractItems(body: any): any[] | undefined {
  if (Array.isArray(body)) return body
  for (const key of ['items', 'data', 'deliveries', 'tickets']) {
    if (Array.isArray(body?.[key])) return body[key]
  }
  return undefined
}

function unwrap(body: any): any {
  return body && typeof body === 'object' && 'data' in body ? body.data : body
}

/* -------------------------------------------------------- Status mappings */

/** Backend OrderStatus → UI OrderStatus. */
const ORDER_STATUS_FROM_BACKEND: Record<string, OrderStatus> = {
  PENDING: 'pending',
  PENDING_PAYMENT: 'pending',
  PAYMENT_FAILED: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'confirmed',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out-for-delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  FAILED: 'cancelled',
}

/** UI OrderStatus → backend OrderStatus. */
const ORDER_STATUS_TO_BACKEND: Record<OrderStatus, string> = {
  pending: 'PENDING',
  confirmed: 'CONFIRMED',
  packed: 'PACKED',
  shipped: 'SHIPPED',
  'out-for-delivery': 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  cancelled: 'CANCELLED',
  returned: 'CANCELLED',
}

/** Backend DeliveryStatus → UI DeliveryStatus. */
const DELIVERY_STATUS_FROM_BACKEND: Record<string, DeliveryStatus> = {
  PENDING: 'unassigned',
  ASSIGNED: 'assigned',
  PACKED: 'assigned',
  PICKED_UP: 'picked-up',
  SHIPPED: 'in-transit',
  IN_TRANSIT: 'in-transit',
  OUT_FOR_DELIVERY: 'in-transit',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  RETURNED: 'failed',
  CANCELLED: 'failed',
}

/** UI DeliveryStatus → backend DeliveryStatus (controlled transitions). */
const DELIVERY_STATUS_TO_BACKEND: Record<DeliveryStatus, string> = {
  unassigned: 'PENDING',
  assigned: 'ASSIGNED',
  'picked-up': 'PICKED_UP',
  'in-transit': 'IN_TRANSIT',
  delivered: 'DELIVERED',
  failed: 'FAILED',
}

/** Backend TicketStatus → UI TicketStatus. */
const TICKET_STATUS_FROM_BACKEND: Record<string, TicketStatus> = {
  OPEN: 'open',
  IN_PROGRESS: 'in-progress',
  WAITING_FOR_CUSTOMER: 'in-progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
}

/** UI TicketStatus → backend TicketStatus. */
const TICKET_STATUS_TO_BACKEND: Record<TicketStatus, string> = {
  open: 'OPEN',
  'in-progress': 'IN_PROGRESS',
  resolved: 'RESOLVED',
  closed: 'CLOSED',
}

const TICKET_PRIORITY_FROM_BACKEND: Record<string, TicketPriority> = {
  LOW: 'low',
  MEDIUM: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
}

const TICKET_PRIORITY_TO_BACKEND: Record<TicketPriority, string> = {
  low: 'LOW',
  normal: 'MEDIUM',
  high: 'HIGH',
  urgent: 'URGENT',
}

/** Backend InvoiceStatus → UI InvoiceStatus. */
const INVOICE_STATUS_FROM_BACKEND: Record<string, Invoice['status']> = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  PAID: 'paid',
  VOID: 'cancelled',
  CANCELLED: 'cancelled',
}

const BACKEND_ROLE_NAMES: Record<string, string> = {
  OWNER: 'owner',
  ADMIN: 'admin',
  STAFF: 'staff',
  CUSTOMER: 'customer',
}

/** Fallback address used when an order/invoice carries no snapshot. */
function emptyAddress(): Address {
  return {
    id: '',
    label: '',
    fullName: '',
    phone: '',
    line1: '',
    city: '',
    state: '',
    pincode: '',
    country: '',
    isDefault: false,
  }
}

/**
 * Backend orders carry no per-step history. The ladder is synthesised from the
 * current status, with creation time stamped on step one and `updatedAt` on the
 * current step — the only moments the API can prove.
 */
function buildOrderTimeline(raw: any): OrderTimelineEntry[] {
  const placedAt = iso(raw.createdAt)
  const updatedAt = iso(raw.updatedAt)
  const current = ORDER_STATUS_FROM_BACKEND[raw.status] ?? 'pending'
  const placed: OrderTimelineEntry = { status: 'placed', label: 'Order placed', at: placedAt, completed: true }
  if (current === 'cancelled') {
    return [placed, { status: 'cancelled', label: 'Cancelled', at: updatedAt, completed: true }]
  }
  const flow: Array<OrderTimelineEntry & { status: OrderStatus }> = [
    { status: 'pending', label: 'Pending', completed: false },
    { status: 'confirmed', label: 'Confirmed', completed: false },
    { status: 'packed', label: 'Packed', completed: false },
    { status: 'shipped', label: 'Shipped', completed: false },
    { status: 'out-for-delivery', label: 'Out for delivery', completed: false },
    { status: 'delivered', label: 'Delivered', completed: false },
  ]
  const currentIndex = flow.findIndex((entry) => entry.status === current)
  return flow.map((entry, index) => ({
    ...entry,
    completed: index <= currentIndex,
    at: entry.status === 'pending' ? placedAt : entry.status === current ? updatedAt : undefined,
  }))
}

function mapOrderItem(raw: any): OrderLineItem {
  return {
    productId: raw.productId ?? '',
    name: raw.name ?? 'Product',
    image: typeof raw.image === 'string' ? raw.image : '',
    unit: typeof raw.unit === 'string' ? raw.unit : 'piece',
    price: num(raw.price),
    quantity: num(raw.quantity, 1),
    sku: typeof raw.sku === 'string' ? raw.sku : '',
  }
}

function mapOrder(raw: any): Order {
  const items = Array.isArray(raw.items) ? raw.items : []
  const address = raw.shippingAddressSnapshot ? normalizeAddress(raw.shippingAddressSnapshot) : undefined
  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    customerId: raw.user?.id ?? raw.userId ?? '',
    customerName: raw.customerName ?? raw.user?.fullName ?? '',
    customerEmail: raw.customerEmail ?? raw.user?.email ?? '',
    items: items.map(mapOrderItem),
    subtotal: num(raw.subtotal),
    savings: num(raw.savings),
    shipping: num(raw.shipping),
    tax: num(raw.tax),
    discount: num(raw.discount),
    total: num(raw.total),
    status: ORDER_STATUS_FROM_BACKEND[raw.status] ?? 'pending',
    paymentStatus: (raw.paymentStatus ?? 'pending').toLowerCase() as Order['paymentStatus'],
    paymentMethod: raw.paymentMethod ? (raw.paymentMethod.toLowerCase() as Order['paymentMethod']) : undefined,
    couponCode: raw.couponCode ?? undefined,
    address,
    timeline: buildOrderTimeline(raw),
    placedAt: iso(raw.createdAt) ?? '',
    updatedAt: iso(raw.updatedAt) ?? '',
    trackingNumber: raw.trackingNumber ?? undefined,
    courier: raw.courier ?? undefined,
    notes: raw.notes ?? undefined,
  }
}

function normalizeAddress(snapshot: any): Address {
  return {
    id: '',
    label: 'Delivery address',
    fullName: str(snapshot.fullName ?? snapshot.name),
    phone: str(snapshot.phone),
    line1: str(snapshot.line1 ?? snapshot.street ?? snapshot.addressLine1),
    line2: str(snapshot.line2 ?? snapshot.street2 ?? snapshot.landmark),
    city: str(snapshot.city),
    state: str(snapshot.state),
    pincode: str(snapshot.pincode ?? snapshot.postalCode),
    country: str(snapshot.country, 'India'),
    isDefault: false,
  }
}

function mapProduct(raw: any): Product {
  const images = Array.isArray(raw.images) ? raw.images.filter((i: any) => typeof i === 'string') : []
  return {
    id: raw.id,
    slug: raw.slug ?? '',
    name: raw.name,
    categorySlug: raw.categorySlug ?? '',
    categoryName: raw.categoryName ?? raw.category?.name ?? '',
    shortDescription: raw.shortDescription ?? '',
    description: raw.description ?? '',
    price: num(raw.price),
    mrp: num(raw.mrp),
    currency: raw.currency === 'INR' ? 'INR' : 'INR',
    unit: raw.unit || 'piece',
    images,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    rating: num(raw.rating, 4.8),
    reviewCount: num(raw.reviewCount),
    stock: num(raw.stock),
    sku: raw.sku ?? '',
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : [],
    allergens: Array.isArray(raw.allergens) ? raw.allergens : [],
    shelfLife: raw.shelfLife ?? '6 Months',
    storage: raw.storage ?? 'Store in a cool, dry place',
    nutrition: Array.isArray(raw.nutrition) ? raw.nutrition : [],
    specifications: Array.isArray(raw.specifications) ? raw.specifications : [],
    isOrganic: bool(raw.isOrganic),
    isBestSeller: bool(raw.isBestSeller),
    isNew: bool(raw.isNew),
    isFeatured: bool(raw.isFeatured),
    active: raw.active ?? bool(raw.isActive),
    createdAt: iso(raw.createdAt) ?? '',
  }
}

function mapCustomer(raw: any): Customer {
  return {
    id: raw.id,
    name: raw.fullName ?? '',
    email: raw.email ?? '',
    phone: raw.phone ?? '',
    status: raw.isActive === false ? 'blocked' : 'active',
    addresses: [],
    orderCount: num(raw.orderCount),
    totalSpent: num(raw.totalSpent),
    marketingOptIn: false,
    joinedAt: iso(raw.createdAt) ?? '',
    lastOrderAt: iso(raw.lastOrderAt),
  }
}

function mapDelivery(raw: any): Delivery {
  const assignedStaff = raw.assignedStaff ?? raw.assignee
  return {
    id: raw.id,
    orderId: raw.orderId ?? '',
    orderNumber: raw.orderNumber ?? '',
    customerName: raw.customerName ?? '',
    city: str(raw.city),
    status: DELIVERY_STATUS_FROM_BACKEND[raw.status] ?? 'unassigned',
    partnerId: assignedStaff?.id ?? undefined,
    partnerName: assignedStaff?.fullName ?? undefined,
    trackingNumber: raw.trackingNumber ?? undefined,
    expectedAt: iso(raw.estimatedDelivery ?? raw.createdAt) ?? '',
    deliveredAt: iso(raw.deliveredAt),
  }
}

function mapDiscount(raw: any): Discount {
  const id = raw.id ?? raw.couponId
  return {
    id,
    code: raw.code ?? raw.couponCode ?? '',
    label: raw.description ?? raw.label ?? '',
    type: raw.discountType === 'FIXED_AMOUNT' ? 'flat' : 'percent',
    value: num(raw.discountValue ?? raw.value),
    minOrderValue: num(raw.minOrderValue),
    maxUses: raw.maxUses > 0 ? num(raw.maxUses, 1000) : 1000,
    usedCount: num(raw.usageCount ?? raw.usedCount),
    appliesTo:
      (raw.productIds?.length ?? 0) > 0 ? 'product' : (raw.categoryIds?.length ?? 0) > 0 ? 'category' : 'all',
    targetIds: Array.isArray(raw.productIds)
      ? [...raw.productIds, ...(Array.isArray(raw.categoryIds) ? raw.categoryIds : [])]
      : Array.isArray(raw.categoryIds)
        ? raw.categoryIds
        : [],
    startsAt: iso(raw.startsAt) ?? '',
    expiresAt: raw.expiresAt == null ? '' : (iso(raw.expiresAt) ?? ''),
    active: raw.isActive ?? bool(raw.active) ?? false,
  }
}

function mapPromotion(raw: any): Promotion {
  return {
    id: raw.id,
    title: raw.title ?? raw.name ?? '',
    subtitle: raw.subtitle ?? raw.description ?? '',
    bannerImageUrl: typeof raw.bannerImageUrl === 'string' ? raw.bannerImageUrl : undefined,
    destinationUrl: typeof raw.destinationUrl === 'string' ? raw.destinationUrl : undefined,
    ctaLabel: typeof raw.ctaLabel === 'string' ? raw.ctaLabel : undefined,
    type: raw.discountType === 'FIXED_AMOUNT' ? 'flat' : 'percent',
    value: num(raw.discountValue),
    minOrderValue: num(raw.minOrderValue),
    startsAt: iso(raw.startDate ?? raw.startsAt) ?? '',
    expiresAt: iso(raw.endDate ?? raw.expiresAt) ?? '',
    active: raw.isActive ?? bool(raw.active),
    priority: num(raw.priority),
  }
}

function mapTicket(raw: any): SupportTicket {
  return {
    id: raw.id,
    ticketNumber: raw.ticketNumber ?? raw.id,
    customerName: raw.customerName ?? '',
    customerEmail: raw.customerEmail ?? '',
    subject: raw.subject ?? '',
    message: raw.description ?? '',
    replies: Array.isArray(raw.messages)
      ? raw.messages.map((reply: any) => ({
          authorName: reply.senderName ?? reply.senderRole ?? 'Customer',
          content: reply.message ?? '',
          at: iso(reply.createdAt) ?? '',
        }))
      : undefined,
    category: 'order',
    priority: TICKET_PRIORITY_FROM_BACKEND[raw.priority] ?? 'normal',
    status: TICKET_STATUS_FROM_BACKEND[raw.status] ?? 'open',
    createdAt: iso(raw.createdAt) ?? '',
    updatedAt: iso(raw.updatedAt) ?? '',
    assigneeId: raw.assignedStaffId ?? undefined,
    assigneeName: raw.assignedStaffName ?? undefined,
  }
}

function mapStaff(raw: any): StaffMember {
  const isActive = raw.isActive !== false
  return {
    id: raw.id,
    name: raw.fullName ?? '',
    email: raw.email ?? '',
    phone: raw.phone ?? '',
    employeeId: raw.employeeId ?? undefined,
    role: (BACKEND_ROLE_NAMES[raw.role] ?? 'staff') as RoleName,
    // Accounts are created with an admin-set password, never invited, so the
    // only two reachable states are active and suspended.
    status: isActive ? 'active' : 'suspended',
    title: raw.roles?.[0]?.name,
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map((permission: any) => permission.slug ?? permission) : undefined,
    createdAt: iso(raw.createdAt) ?? '',
    lastActiveAt: iso(raw.lastLoginAt),
  }
}

function mapRole(raw: any): Role {
  const name = (BACKEND_ROLE_NAMES[raw.name] ?? 'staff') as Role['name']
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    description: raw.description ?? '',
    permissions: Array.isArray(raw.permissions)
      ? (raw.permissions.map((permission: any) => permission.slug ?? permission) as Role['permissions'])
      : [],
    system: raw.isSystem ?? true,
  }
}

function mapAudit(raw: any): AuditLog {
  const action = auditActionFromRaw(raw.action)
  return {
    id: raw.id,
    actor: raw.actor?.fullName ?? raw.actor?.email ?? raw.actorEmail ?? raw.actorId ?? 'System',
    action,
    entity: raw.entity ?? '',
    entityId: raw.entityId ?? undefined,
    summary: describeAuditAction(raw.action ?? ''),
    ipAddress: raw.ipAddress ?? '',
    tone: auditTone(action),
    createdAt: iso(raw.createdAt) ?? '',
  }
}

function auditActionFromRaw(raw: string): AuditAction {
  const upper = (raw ?? '').toUpperCase()
  if (upper.includes('SETTING')) return 'settings'
  if (upper.includes('LOGIN') || upper === 'AUTH_LOGIN') return 'login'
  if (upper.includes('LOGOUT')) return 'logout'
  if (upper.includes('EXPORT')) return 'export'
  if (/_DELETED$|_REMOVED$|_ARCHIVED$/.test(upper)) return 'delete'
  if (/_CREATED$|_ADDED$/.test(upper)) return 'create'
  if (/_UPDATED$|_CHANGED$|_MODIFIED$/.test(upper)) return 'update'
  return 'update'
}

function describeAuditAction(raw: string): string {
  const words = raw
    .split('_')
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  if (words.length === 0) return ''
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1)
  return words.join(' ')
}

function auditTone(action: AuditAction): AuditLog['tone'] {
  if (action === 'delete') return 'danger'
  if (action === 'create') return 'success'
  if (action === 'login') return 'success'
  if (action === 'logout' || action === 'update' || action === 'settings') return 'info'
  return 'neutral'
}

function mapPaymentGateway(raw: any): PaymentGatewaySettings {
  return {
    provider: 'razorpay',
    razorpayKeyId: str(raw.razorpayKeyId),
    razorpayKeySecretMasked: str(raw.razorpayKeySecretMasked, '••••••••••••'),
    webhookSecretMasked: str(raw.webhookSecretMasked, '••••••••••••'),
    enabledMethods: Array.isArray(raw.enabledMethods)
      ? (raw.enabledMethods.map((method: string) => method.toLowerCase()) as PaymentGatewaySettings['enabledMethods'])
      : [],
    testMode: raw.testMode !== undefined ? bool(raw.testMode) : true,
    codEnabled: raw.codEnabled !== undefined ? bool(raw.codEnabled) : true,
    codLimit: num(raw.codLimit, 5000),
    configured: raw.configured ?? (bool(raw.hasKeySecret) && bool(raw.hasWebhookSecret)),
  }
}

function mapInvoice(raw: any): Invoice {
  const shipping = raw.shippingAddressSnapshot ? normalizeAddress(raw.shippingAddressSnapshot) : emptyAddress()
  const billing = raw.billingAddressSnapshot ? normalizeAddress(raw.billingAddressSnapshot) : shipping
  return {
    id: raw.id,
    invoiceNumber: raw.invoiceNumber ?? raw.id,
    orderId: raw.orderId ?? '',
    orderNumber: raw.order?.orderNumber ?? '',
    customerName: raw.order?.customerName ?? raw.customerName ?? '',
    customerEmail: raw.order?.customerEmail ?? raw.customerEmail ?? '',
    billingAddress: billing ?? shipping ?? emptyAddress(),
    shippingAddress: shipping ?? emptyAddress(),
    items: Array.isArray(raw.items) ? raw.items.map(mapOrderItem) : Array.isArray(raw.order?.items) ? raw.order.items.map(mapOrderItem) : [],
    subtotal: num(raw.subtotal),
    discount: num(raw.discount),
    shipping: num(raw.shipping),
    tax: num(raw.tax),
    total: num(raw.total),
    status: INVOICE_STATUS_FROM_BACKEND[raw.status] ?? 'issued',
    issuedAt: iso(raw.invoiceDate ?? raw.createdAt) ?? '',
    dueAt: iso(raw.invoiceDate ?? raw.createdAt) ?? '',
    gstin: undefined,
    notes: undefined,
  }
}

function mapCategory(raw: any): Category {
  return {
    id: raw.id,
    slug: raw.slug ?? '',
    name: raw.name ?? '',
    tagline: raw.tagline ?? '',
    description: raw.description ?? '',
    image: typeof raw.image === 'string' ? raw.image : (Array.isArray(raw.images) ? raw.images[0] : '') ?? '',
    accent: '',
    featured: bool(raw.isFeatured ?? raw.featured),
    sortOrder: num(raw.sortOrder),
  }
}

function mapInventoryAlert(raw: any): InventoryAlert {
  return {
    productId: raw.productId ?? raw.id,
    name: raw.productName ?? raw.product?.name ?? '',
    sku: raw.product?.sku ?? raw.sku ?? '',
    image: typeof raw.primaryImage === 'string' ? raw.primaryImage : raw.product?.primaryImage ?? '',
    stock: num(raw.availableQuantity, num(raw.stock)),
    reorderLevel: num(raw.reorderThreshold, 10),
  }
}

/* ------------------------------------------------------------ Dashboard */

export interface DashboardData {
  metrics: DashboardMetric[]
  revenueSeries: RevenuePoint[]
  topProducts: TopProduct[]
  recentOrders: Order[]
  recentCustomers: Customer[]
  orderStatusBreakdown: Array<{ label: string; value: number; tone: AuditLog['tone'] }>
  categoryPerformance: Array<{ name: string; count: number; stock: number; value: number; share: number }>
  lowStockCount: number
}

/** Maps a human-readable status label onto the console's tone palette. */
function statusToneForLabel(label: string): StatusTone {
  const value = label.toLowerCase()
  if (value.includes('deliver') || value.includes('confirm') || value.includes('pack') || value.includes('ship')) {
    return 'success'
  }
  if (value.includes('cancel') || value.includes('fail')) return 'danger'
  if (value.includes('pending') || value.includes('process')) return 'warning'
  return 'neutral'
}

/**
 * Maps the dashboard aggregate payload onto the console's typed views.
 *
 * Every widget is now computed server-side (`GET /admin/dashboard`) against the
 * full dataset with an explicit date window. The console no longer fans out to
 * paginated `fetchAll` calls or reconstructs revenue/top-product metrics from a
 * truncated slice of recent orders, which is what produced both the wrong
 * figures and the 60s timeouts.
 */
function buildDashboardData(body: any): DashboardData {
  const data = unwrap(body) ?? body
  const overview = data.overview ?? {}
  const recentOrders: Order[] = Array.isArray(data.recentOrders) ? data.recentOrders.map(mapOrder) : []
  const recentCustomers: Customer[] = Array.isArray(data.recentCustomers)
    ? data.recentCustomers.map(mapCustomer)
    : []

  const currencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  })

  const metrics: DashboardMetric[] = [
    {
      id: 'revenue',
      label: 'Revenue',
      value: currencyFormatter.format(num(overview.revenue30d)),
      delta: 0,
      trend: 'flat',
      hint: 'Paid orders · last 30 days',
      tone: 'success',
    },
    {
      id: 'orders',
      label: 'Orders',
      value: String(num(overview.totalOrders)),
      delta: 0,
      trend: 'flat',
      hint: `${num(overview.pendingOrders)} awaiting fulfilment`,
      tone: 'neutral',
    },
    {
      id: 'customers',
      label: 'Customers',
      value: String(num(overview.totalCustomers)),
      delta: 0,
      trend: 'flat',
      hint: 'Registered accounts',
      tone: 'info',
    },
    {
      id: 'lowstock',
      label: 'Low stock',
      value: String(num(overview.lowStock)),
      delta: 0,
      trend: 'flat',
      hint: 'Items at or below reorder level',
      tone: 'warning',
    },
    {
      id: 'delivery',
      label: 'Delivered',
      value: String(num(overview.deliveredOrders)),
      delta: 0,
      trend: 'flat',
      hint: 'Orders marked delivered',
      tone: 'success',
    },
  ]

  const revenueSeries: RevenuePoint[] = Array.isArray(data.revenueSeries)
    ? data.revenueSeries.map((point: any, index: number) => ({
        label: str(point.label, `Wk ${index + 1}`),
        revenue: num(point.revenue),
        orders: num(point.orders),
      }))
    : []

  const topProducts: TopProduct[] = Array.isArray(data.topProducts)
    ? data.topProducts.map((product: any) => ({
        productId: str(product.productId),
        name: str(product.name, 'Product'),
        image: str(product.image),
        unitsSold: num(product.unitsSold),
        revenue: num(product.revenue),
      }))
    : []

  const orderStatusBreakdown: Array<{ label: string; value: number; tone: StatusTone }> =
    Array.isArray(data.orderStatusBreakdown)
      ? data.orderStatusBreakdown.map((item: any) => ({
          label: str(item.label),
          value: num(item.value),
          tone: statusToneForLabel(str(item.label)),
        }))
      : []

  const categoryPerformance: Array<{ name: string; count: number; stock: number; value: number; share: number }> =
    Array.isArray(data.categoryPerformance)
      ? data.categoryPerformance.map((entry: any) => ({
          name: str(entry.name),
          count: num(entry.count),
          stock: num(entry.stock),
          value: num(entry.value),
          share: num(entry.share),
        }))
      : []

  return {
    metrics,
    revenueSeries,
    topProducts,
    recentOrders: [...recentOrders].sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1)).slice(0, 8),
    recentCustomers: recentCustomers.slice(0, 4),
    orderStatusBreakdown,
    categoryPerformance,
    lowStockCount: num(data.lowStockCount, num(overview.lowStock, 0)),
  }
}

/* ------------------------------------------------------------- Service */

/**
 * Admin API service. Every client method maps the backend HTTP contract onto
 * the typed views the console renders. Writes are purely API calls — the local
 * demo store was removed when the console was wired to the real backend.
 */
export const adminService = {
  /* ------------------------------------------------------------ Dashboard */
  async dashboard(options?: RequestOptions): Promise<DashboardData> {
    // Single aggregate call. The backend returns every widget; the console must
    // not fan out to paginated product/customer/ticket lists here — that chain
    // was what blew the 60s request budget.
    const body = await apiFetchRaw<any>('/admin/dashboard', undefined, options)
    return buildDashboardData(body)
  },

  /** Reports page entry point — the API aliases `/admin/analytics` to the dashboard. */
  analytics(options?: RequestOptions): Promise<DashboardData> {
    return this.dashboard(options)
  },

  async inventoryAlerts(options?: RequestOptions): Promise<InventoryAlert[]> {
    const body = await apiFetchRaw<any>('/admin/inventory/low-stock?page=1&limit=100', undefined, options)
    const items = extractItems(body) ?? []
    return items.map(mapInventoryAlert)
  },

  async categories(options?: RequestOptions): Promise<Category[]> {
    const body = await apiFetchRaw<any>('/admin/categories?page=1&limit=100', undefined, options)
    return (extractItems(body) ?? []).map(mapCategory)
  },

  /* ---------------------------------------------------------------- Reads */
  async customers(options?: RequestOptions): Promise<Customer[]> {
    const items = await fetchAll<any>('/admin/customers', options)
    return items.map(mapCustomer)
  },

  async customer(id: string, options?: RequestOptions): Promise<Customer | undefined> {
    const list = await this.customers(options)
    return list.find((customer) => customer.id === id)
  },

  async orders(options?: RequestOptions): Promise<Order[]> {
    const items = await fetchAll<any>('/admin/orders', options, (body) =>
      Array.isArray(body?.items) ? body.items : undefined,
    )
    return items.map(mapOrder)
  },

  async order(id: string, options?: RequestOptions): Promise<Order | undefined> {
    try {
      const raw = await apiFetchRaw<any>(`/orders/${id}`, undefined, options)
      if (!raw) return undefined
      return mapOrder(unwrap(raw) ?? raw)
    } catch {
      const list = await this.orders(options)
      return list.find((order) => order.id === id)
    }
  },

  async invoices(options?: RequestOptions): Promise<Invoice[]> {
    return fetchAll<Invoice>('/invoices', options, (body) => (extractItems(body) ?? []).map(mapInvoice))
  },

  async deliveries(options?: RequestOptions): Promise<Delivery[]> {
    const body = await apiFetchRaw<any>('/admin/delivery?page=1&limit=100&per_page=100', undefined, options)
    return (extractItems(body) ?? []).map(mapDelivery)
  },

  async deliveryPartners(options?: RequestOptions): Promise<DeliveryPartner[]> {
    try {
      const staff = await this.staff(options)
      return staff.map((member) => ({
        id: member.id,
        name: member.name,
        phone: member.phone,
        active: member.status === 'active',
      }))
    } catch {
      // Delivery partners derive from the staff directory, which STAFF cannot read.
      // There is no dedicated partner endpoint yet — see the integration report.
      return []
    }
  },

  async discounts(options?: RequestOptions): Promise<Discount[]> {
    const body = await apiFetchRaw<any>('/admin/discounts/coupons?page=1&limit=100&per_page=100', undefined, options)
    return (extractItems(body) ?? []).map(mapDiscount)
  },

  async promotions(options?: RequestOptions): Promise<Promotion[]> {
    const body = await apiFetchRaw<any>('/admin/discounts/promotions?page=1&limit=100&per_page=100', undefined, options)
    return (extractItems(body) ?? []).map(mapPromotion)
  },

  async products(options?: RequestOptions): Promise<Product[]> {
    return fetchAll<Product>('/admin/products', options)
  },

  async product(id: string, options?: RequestOptions): Promise<Product | undefined> {
    try {
      const raw = await apiFetchRaw<any>(`/admin/products/${id}`, undefined, options)
      return raw ? mapProduct(unwrap(raw) ?? raw) : undefined
    } catch {
      const list = await this.products(options)
      return list.find((product) => product.id === id)
    }
  },

  async tickets(options?: RequestOptions): Promise<SupportTicket[]> {
    const items = await fetchAll<any>('/admin/support/tickets', options)
    return items.map(mapTicket)
  },

  async ticket(id: string, options?: RequestOptions): Promise<SupportTicket | undefined> {
    const raw = await apiFetchRaw<any>(`/admin/support/tickets/${id}`, undefined, options)
    return raw ? mapTicket(unwrap(raw) ?? raw) : undefined
  },

  async roles(options?: RequestOptions): Promise<Role[]> {
    const body = await apiFetchRaw<any>('/admin/roles?page=1&limit=100', undefined, options)
    return (extractItems(body) ?? []).map(mapRole)
  },

  async permissions(options?: RequestOptions): Promise<Permission[]> {
    const body = await apiFetchRaw<any>('/admin/permissions?page=1&limit=100', undefined, options)
    return (extractItems(body) ?? [])
      .map((permission: any) => permission.slug ?? permission)
      .filter((slug: unknown): slug is Permission => typeof slug === 'string')
  },

  async staff(options?: RequestOptions): Promise<StaffMember[]> {
    const body = await apiFetchRaw<any>('/admin/staff?page=1&limit=100&per_page=100', undefined, options)
    return (extractItems(body) ?? []).map(mapStaff)
  },

  async auditLogs(options?: RequestOptions): Promise<AuditLog[]> {
    return fetchAll<AuditLog>('/admin/audit-logs', options, (body) => (extractItems(body) ?? []).map(mapAudit))
  },

  async paymentGateway(options?: RequestOptions): Promise<PaymentGatewaySettings> {
    const raw = await apiFetchRaw<any>('/admin/payment-settings', undefined, options)
    return mapPaymentGateway(raw ?? {})
  },

  async brand(options?: RequestOptions): Promise<BrandSettings> {
    const body = await apiFetchRaw<any>('/admin/settings', undefined, options)
    const items = Array.isArray(body?.items) ? body.items : []
    const byKey = new Map(items.map((item: any) => [item.key, item.value]))
    return {
      logoUrl: str(byKey.get('brand_logo_url')),
      logoName: str(byKey.get('brand_name'), 'Vedhic Foods'),
      themePreset: str(byKey.get('brand_theme_preset'), 'forest'),
      primary: str(byKey.get('brand_color_primary'), '#1f3d2b'),
      secondary: str(byKey.get('brand_color_secondary'), '#6b7b3a'),
      accent: str(byKey.get('brand_color_accent'), '#c9a24b'),
      background: str(byKey.get('brand_color_background'), '#f6f1e6'),
    }
  },

  /* ---------------------------------------------------------------- Writes */
  async createProduct(input: Omit<Product, 'id' | 'createdAt'> & { id?: string }, options?: RequestOptions) {
    const body = {
      name: input.name,
      sku: input.sku,
      price: input.price,
      mrp: input.mrp,
      shortDescription: input.shortDescription || undefined,
      description: input.description || undefined,
      unit: input.unit || undefined,
      categorySlug: input.categorySlug || undefined,
      images: Array.isArray(input.images) ? input.images : [],
      isActive: input.active,
      tags: input.tags?.length ? input.tags : undefined,
      isOrganic: input.isOrganic,
      isBestSeller: input.isBestSeller,
      isNew: input.isNew,
      isFeatured: input.isFeatured,
      stock: input.stock,
    }
    const created = await apiFetchRaw<any>('/admin/products', { method: 'POST', body: JSON.stringify(body) }, options)
    return mapProduct(unwrap(created) ?? created)
  },

  async updateProduct(id: string, patch: Partial<Product>, options?: RequestOptions) {
    const body: Record<string, unknown> = {}
    if (patch.name !== undefined) body.name = patch.name
    if (patch.sku !== undefined) body.sku = patch.sku
    if (patch.price !== undefined) body.price = patch.price
    if (patch.mrp !== undefined) body.mrp = patch.mrp
    if (patch.shortDescription !== undefined) body.shortDescription = patch.shortDescription
    if (patch.description !== undefined) body.description = patch.description
    if (patch.unit !== undefined) body.unit = patch.unit
    if (patch.categorySlug !== undefined) body.categorySlug = patch.categorySlug
    if (patch.stock !== undefined) body.stock = patch.stock
    if (patch.active !== undefined) body.isActive = patch.active
    if (patch.tags !== undefined) body.tags = patch.tags
    if (patch.isOrganic !== undefined) body.isOrganic = patch.isOrganic
    if (patch.isBestSeller !== undefined) body.isBestSeller = patch.isBestSeller
    if (patch.isNew !== undefined) body.isNew = patch.isNew
    if (patch.isFeatured !== undefined) body.isFeatured = patch.isFeatured
    if (patch.images !== undefined) body.images = patch.images
    if (patch.netWeight !== undefined) body.netWeight = patch.netWeight
    if (patch.rating !== undefined) body.rating = patch.rating
    if (patch.reviewCount !== undefined) body.reviewCount = patch.reviewCount
    if (patch.ingredients !== undefined) body.ingredients = patch.ingredients
    if (patch.allergens !== undefined) body.allergens = patch.allergens
    if (patch.shelfLife !== undefined) body.shelfLife = patch.shelfLife
    if (patch.storage !== undefined) body.storage = patch.storage
    if (patch.nutrition !== undefined) body.nutrition = patch.nutrition
    if (patch.specifications !== undefined) body.specifications = patch.specifications
    const updated = await apiFetchRaw<any>(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }, options)
    return mapProduct(unwrap(updated) ?? updated)
  },

  async deleteProduct(id: string, options?: RequestOptions) {
    await apiFetchRaw<any>(`/admin/products/${id}`, { method: 'DELETE' }, options)
  },

  /**
   * Manual stock adjustment with an audit reason. Prefer this over
   * `updateProduct(..., { stock })`, which syncs inventory without a reason trail.
   */
  async adjustInventory(productId: string, input: { delta: number; reason?: string }, options?: RequestOptions) {
    const body = {
      quantity: Math.abs(input.delta),
      type: input.delta >= 0 ? 'ADD_STOCK' : 'REMOVE_STOCK',
      reason: input.reason || 'Manual adjustment',
    }
    const result = await apiFetchRaw<any>(`/admin/inventory/${productId}/adjust`, { method: 'POST', body: JSON.stringify(body) }, options)
    return unwrap(result) ?? result
  },

  /* -------------------------------------------------------------- Orders */
  async updateOrderStatus(id: string, status: Order['status'], options?: RequestOptions) {
    if (status === 'returned') {
      throw new Error('Returned orders are not supported by the backend fulfillment engine yet.')
    }
    const updated = await apiFetchRaw<any>(
      `/admin/orders/${id}/status`,
      { method: 'PUT', body: JSON.stringify({ status: ORDER_STATUS_TO_BACKEND[status] }) },
      options,
    )
    return mapOrder(unwrap(updated) ?? updated)
  },

  /* ----------------------------------------------------------- Deliveries */
  async updateDelivery(id: string, patch: Partial<Delivery>, options?: RequestOptions) {
    if (patch.partnerId !== undefined) {
      const assigned = await apiFetchRaw<any>(
        `/admin/delivery/${id}/assign`,
        { method: 'POST', body: JSON.stringify({ assignedStaffId: patch.partnerId }) },
        options,
      )
      return unwrap(assigned) ?? assigned
    }
    if (patch.status !== undefined) {
      const updated = await apiFetchRaw<any>(
        `/admin/delivery/${id}/status`,
        { method: 'PATCH', body: JSON.stringify({ status: DELIVERY_STATUS_TO_BACKEND[patch.status] }) },
        options,
      )
      return unwrap(updated) ?? updated
    }
    const body: Record<string, unknown> = {}
    if (patch.trackingNumber !== undefined) body.trackingNumber = patch.trackingNumber
    const updated = await apiFetchRaw<any>(`/admin/delivery/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, options)
    return unwrap(updated) ?? updated
  },

  /* ----------------------------------------------------------- Discounts */
  async createDiscount(input: Omit<Discount, 'id'>, options?: RequestOptions) {
    if (input.type === 'shipping') {
      throw new Error('Shipping discounts are not supported by the backend coupon engine.')
    }
    const code = (input.code ?? '').trim().toUpperCase()
    if (!code) throw new Error('Coupon code is required.')
    const now = new Date().toISOString()
    const body = {
      code,
      discountType: input.type === 'flat' ? 'FIXED_AMOUNT' : 'PERCENTAGE',
      discountValue: input.value,
      minOrderValue: input.minOrderValue ?? 0,
      description: input.label || undefined,
      maxUses: input.maxUses > 0 ? input.maxUses : 1_000_000,
      perUserLimit: 1,
      startsAt: input.startsAt || now,
      expiresAt: input.expiresAt || null,
      isActive: input.active ?? true,
      productIds: input.appliesTo === 'product' ? input.targetIds : [],
      categoryIds: input.appliesTo === 'category' ? input.targetIds : [],
    }
    const created = await apiFetchRaw<any>('/admin/discounts/coupons', { method: 'POST', body: JSON.stringify(body) }, options)
    return mapDiscount(unwrap(created) ?? created)
  },

  async updateDiscount(id: string, patch: Partial<Discount>, options?: RequestOptions) {
    if (patch.type === 'shipping') {
      throw new Error('Shipping discounts are not supported by the backend coupon engine.')
    }
    const body: Record<string, unknown> = {}
    if (patch.label !== undefined) body.description = patch.label
    if (patch.type !== undefined) body.discountType = patch.type === 'flat' ? 'FIXED_AMOUNT' : 'PERCENTAGE'
    if (patch.value !== undefined) body.discountValue = patch.value
    if (patch.minOrderValue !== undefined) body.minOrderValue = patch.minOrderValue
    if (patch.maxUses !== undefined) body.maxUses = patch.maxUses > 0 ? patch.maxUses : 1_000_000
    if (patch.startsAt !== undefined) body.startsAt = patch.startsAt || new Date().toISOString()
    if (patch.expiresAt !== undefined) body.expiresAt = patch.expiresAt || null
    if (patch.active !== undefined) body.isActive = patch.active
    if (patch.appliesTo !== undefined && patch.targetIds !== undefined) {
      if (patch.appliesTo === 'product') {
        body.productIds = patch.targetIds
        body.categoryIds = []
      } else if (patch.appliesTo === 'category') {
        body.categoryIds = patch.targetIds
        body.productIds = []
      }
    }
    const updated = await apiFetchRaw<any>(`/admin/discounts/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, options)
    return mapDiscount(unwrap(updated) ?? updated)
  },

  async deleteDiscount(id: string, options?: RequestOptions) {
    await apiFetchRaw<any>(`/admin/discounts/coupons/${id}`, { method: 'DELETE' }, options)
  },

  /* ---------------------------------------------------------- Promotions */
  async createPromotion(input: Omit<Promotion, 'id'>, options?: RequestOptions) {
    if (input.type === 'shipping') {
      throw new Error('Shipping discounts are not supported by the backend coupon engine.')
    }
    const body = {
      name: input.title,
      description: input.subtitle || undefined,
      title: input.title,
      subtitle: input.subtitle || undefined,
      bannerImageUrl: input.bannerImageUrl || undefined,
      destinationUrl: input.destinationUrl || undefined,
      ctaLabel: input.ctaLabel || undefined,
      discountType: input.type === 'flat' ? 'FIXED_AMOUNT' : 'PERCENTAGE',
      discountValue: input.value,
      minOrderValue: input.minOrderValue ?? 0,
      startDate: input.startsAt,
      endDate: input.expiresAt,
      isActive: input.active ?? true,
      priority: input.priority ?? 0,
    }
    const created = await apiFetchRaw<any>('/admin/discounts/promotions', { method: 'POST', body: JSON.stringify(body) }, options)
    return mapPromotion(unwrap(created) ?? created)
  },

  async updatePromotion(id: string, patch: Partial<Promotion>, options?: RequestOptions) {
    if (patch.type === 'shipping') {
      throw new Error('Shipping discounts are not supported by the backend coupon engine.')
    }
    const body: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      body.name = patch.title
      body.title = patch.title
    }
    if (patch.subtitle !== undefined) {
      body.description = patch.subtitle
      body.subtitle = patch.subtitle
    }
    if (patch.bannerImageUrl !== undefined) body.bannerImageUrl = patch.bannerImageUrl || null
    if (patch.destinationUrl !== undefined) body.destinationUrl = patch.destinationUrl || null
    if (patch.ctaLabel !== undefined) body.ctaLabel = patch.ctaLabel || null
    if (patch.type !== undefined) body.discountType = patch.type === 'flat' ? 'FIXED_AMOUNT' : 'PERCENTAGE'
    if (patch.value !== undefined) body.discountValue = patch.value
    if (patch.minOrderValue !== undefined) body.minOrderValue = patch.minOrderValue
    if (patch.startsAt !== undefined) body.startDate = patch.startsAt
    if (patch.expiresAt !== undefined) body.endDate = patch.expiresAt
    if (patch.active !== undefined) body.isActive = patch.active
    if (patch.priority !== undefined) body.priority = patch.priority
    const updated = await apiFetchRaw<any>(`/admin/discounts/promotions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, options)
    return mapPromotion(unwrap(updated) ?? updated)
  },

  async deletePromotion(id: string, options?: RequestOptions) {
    await apiFetchRaw<any>(`/admin/discounts/promotions/${id}`, { method: 'DELETE' }, options)
  },

  /* -------------------------------------------------------------- Staff */
  async createStaff(input: Omit<StaffMember, 'id'> & { id?: string; password?: string }, options?: RequestOptions) {
    const role = (input.role ?? 'staff').toUpperCase()
    // OWNER/ADMIN inherit every permission by role; the API refuses a per-user
    // grant set for them (400), so only attach permissions for STAFF targets.
    const privileged = role === 'OWNER' || role === 'ADMIN'
    const permissionSlugs = !privileged && input.permissions?.length ? input.permissions : undefined
    const body = {
      fullName: input.name,
      email: input.email,
      password: input.password,
      phone: input.phone || undefined,
      role,
      employeeId: input.employeeId || undefined,
      status: input.status === 'suspended' ? 'suspended' : 'active',
      permissionSlugs,
    }
    const created = await apiFetchRaw<any>('/admin/staff', { method: 'POST', body: JSON.stringify(body) }, options)
    // The endpoint replies `{ success, message, staff }` rather than `{ data }`.
    const staff = mapStaff(created?.staff ?? unwrap(created) ?? created)
    if (permissionSlugs) {
      await apiFetchRaw<any>(`/admin/staff/${staff.id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissionSlugs }) }, options)
    }
    return staff
  },

  async updateStaff(id: string, patch: Partial<StaffMember>, options?: RequestOptions) {
    const { name, role, status, phone, employeeId, permissions } = patch
    const body: Record<string, unknown> = {}
    if (name !== undefined) body.fullName = name
    if (phone !== undefined) body.phone = phone
    if (employeeId !== undefined) body.employeeId = employeeId
    if (role !== undefined) body.role = role.toUpperCase()
    if (status !== undefined) body.isActive = status === 'active'
    if (Object.keys(body).length > 0) {
      await apiFetchRaw<any>(`/admin/staff/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, options)
    }
    // Skip the per-user grant write for OWNER/ADMIN targets: they already inherit
    // every permission and the API rejects the request with 400.
    const privileged = role === 'owner' || role === 'admin'
    if (permissions !== undefined && !privileged) {
      await apiFetchRaw<any>(`/admin/staff/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissionSlugs: permissions }) }, options)
    }
    return patch
  },

  async deleteStaff(id: string, options?: RequestOptions) {
    await apiFetchRaw<any>(`/admin/staff/${id}`, { method: 'DELETE' }, options)
  },

  /* --------------------------------------------------- Payment + branding */
  async savePaymentGateway(patch: Partial<PaymentGatewaySettings>, options?: RequestOptions) {
    const body: Record<string, unknown> = {}
    if (patch.razorpayKeyId !== undefined) body.razorpayKeyId = patch.razorpayKeyId
    if (patch.razorpayKeySecretMasked !== undefined) body.razorpayKeySecretMasked = patch.razorpayKeySecretMasked
    if (patch.webhookSecretMasked !== undefined) body.webhookSecretMasked = patch.webhookSecretMasked
    if (patch.enabledMethods !== undefined) body.enabledMethods = patch.enabledMethods
    if (patch.testMode !== undefined) body.testMode = patch.testMode
    if (patch.codEnabled !== undefined) body.codEnabled = patch.codEnabled
    if (patch.codLimit !== undefined) body.codLimit = patch.codLimit
    const saved = await apiFetchRaw<any>('/admin/payment-settings', { method: 'PUT', body: JSON.stringify(body) }, options)
    return mapPaymentGateway(saved ?? {})
  },

  async saveBrand(patch: Partial<BrandSettings>, options?: RequestOptions) {
    const settings: Array<{ key: string; value: unknown }> = []
    if (patch.logoUrl !== undefined) settings.push({ key: 'brand_logo_url', value: patch.logoUrl })
    if (patch.logoName !== undefined) settings.push({ key: 'brand_name', value: patch.logoName })
    if (patch.themePreset !== undefined) settings.push({ key: 'brand_theme_preset', value: patch.themePreset })
    if (patch.primary !== undefined) settings.push({ key: 'brand_color_primary', value: patch.primary })
    if (patch.secondary !== undefined) settings.push({ key: 'brand_color_secondary', value: patch.secondary })
    if (patch.accent !== undefined) settings.push({ key: 'brand_color_accent', value: patch.accent })
    if (patch.background !== undefined) settings.push({ key: 'brand_color_background', value: patch.background })
    if (settings.length > 0) {
      await apiFetchRaw<any>('/admin/settings', { method: 'PUT', body: JSON.stringify({ settings }) }, options)
    }
    return this.brand(options)
  },

  /* ----------------------------------------------------------- Tickets */
  async updateTicketStatus(id: string, status: SupportTicket['status'], options?: RequestOptions, meta?: { resolution?: string; closeReason?: string; priority?: SupportTicket['priority'] }) {
    const body: Record<string, unknown> = { status: TICKET_STATUS_TO_BACKEND[status] }
    if (meta?.resolution !== undefined) body.resolution = meta.resolution
    if (meta?.closeReason !== undefined) body.closeReason = meta.closeReason
    if (meta?.priority !== undefined) body.priority = TICKET_PRIORITY_TO_BACKEND[meta.priority]
    const updated = await apiFetchRaw<any>(`/admin/support/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }, options)
    return mapTicket(unwrap(updated) ?? updated)
  },

  async updateTicketAssignee(id: string, assigneeId: string | undefined, _assigneeName: string | undefined, options?: RequestOptions) {
    const updated = await apiFetchRaw<any>(
      `/admin/support/tickets/${id}/assign`,
      { method: 'PATCH', body: JSON.stringify({ assignedStaffId: assigneeId ?? null }) },
      options,
    )
    return mapTicket(unwrap(updated) ?? updated)
  },

  async replyTicket(id: string, content: string, options?: RequestOptions) {
    const updated = await apiFetchRaw<any>(
      `/admin/support/tickets/${id}/messages`,
      { method: 'POST', body: JSON.stringify({ message: content }) },
      options,
    )
    return mapTicket(unwrap(updated) ?? updated)
  },

  /* ----------------------------------------------- Image upload (S3) */
  /**
   * Presigned upload + attach to a product. Upload happens straight to S3 with
   * the caller's browser credentials (no auth header), then the result is
   * attached through the admin API.
   */
  async uploadProductImage(
    productId: string,
    file: File,
    onProgress?: (pct: number) => void,
    options?: RequestOptions & { signal?: AbortSignal },
  ) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    const presigned = await apiFetchRaw<any>(
      `/admin/products/${productId}/images/presigned-url`,
      {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: `image/${extension}`, sizeBytes: file.size }),
      },
      options,
    )
    const { uploadUrl, fileUrl, s3Key } = presigned ?? {}
    if (!uploadUrl) throw new Error('Failed to obtain a presigned upload URL.')
    onProgress?.(30)
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      signal: options?.signal,
    })
    if (!uploadResponse.ok) throw new Error(`Upload to storage failed (status ${uploadResponse.status}).`)
    onProgress?.(70)
    const attached = await apiFetchRaw<any>(
      `/admin/products/${productId}/images`,
      { method: 'POST', body: JSON.stringify({ imageUrl: fileUrl, s3Key }) },
      options,
    )
    onProgress?.(100)
    return unwrap(attached) ?? attached
  },
}

type Permission = import('@/types').Permission