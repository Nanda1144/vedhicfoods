import type {
  AuditLog,
  Customer,
  DashboardMetric,
  Delivery,
  DeliveryPartner,
  Discount,
  Invoice,
  Order,
  OrderLineItem,
  OrderStatus,
  OrderTimelineEntry,
  PaymentMethod,
  PaymentStatus,
  Permission,
  Promotion,
  RevenuePoint,
  Role,
  StaffMember,
  SupportTicket,
  TopProduct,
} from '@/types'
import { PRODUCTS, PRODUCT_BY_SLUG } from './products'

/* ------------------------------------------------------------- Customers */

const CUSTOMER_SEED: Array<[string, string, string, string, string]> = [
  ['Ananya Rao', 'ananya.rao@example.com', '9845012345', 'Bengaluru', 'Karnataka'],
  ['Vikram Menon', 'vikram.menon@example.com', '9822011223', 'Pune', 'Maharashtra'],
  ['Priya Nair', 'priya.nair@example.com', '9895567812', 'Kochi', 'Kerala'],
  ['Rahul Deshpande', 'rahul.d@example.com', '9948123456', 'Hyderabad', 'Telangana'],
  ['Meera Iyer', 'meera.iyer@example.com', '9840098765', 'Chennai', 'Tamil Nadu'],
  ['Karan Bhatt', 'karan.bhatt@example.com', '9909876543', 'Ahmedabad', 'Gujarat'],
  ['Sneha Kulkarni', 'sneha.k@example.com', '9765432109', 'Nagpur', 'Maharashtra'],
  ['Arjun Reddy', 'arjun.reddy@example.com', '9701234567', 'Bengaluru', 'Karnataka'],
  ['Divya Sharma', 'divya.sharma@example.com', '9811122233', 'New Delhi', 'Delhi'],
  ['Nikhil Joshi', 'nikhil.joshi@example.com', '9933445566', 'Mumbai', 'Maharashtra'],
]

export const CUSTOMERS: Customer[] = CUSTOMER_SEED.map(([name, email, phone, city, state], i) => ({
  id: `cus-${String(i + 1).padStart(3, '0')}`,
  name,
  email,
  phone,
  status: i === 8 ? 'blocked' : i === 6 ? 'inactive' : 'active',
  addresses: [
    {
      id: `addr-${i + 1}-1`,
      label: 'Home',
      fullName: name,
      phone,
      line1: `${100 + i * 7}, ${['Jayanagar 4th Block', 'Koregaon Park', 'Panampilly Nagar', 'Banjara Hills', 'Adyar', 'Satellite', 'Dharampeth', 'Indiranagar', 'Hauz Khas', 'Bandra West'][i]}`,
      line2: 'Near City Mall',
      city,
      state,
      pincode: `${560000 + i * 137}`.slice(0, 6),
      country: 'India',
      isDefault: true,
    },
  ],
  orderCount: 1 + ((i * 3) % 9),
  totalSpent: 2800 + i * 1840,
  marketingOptIn: i % 3 !== 0,
  joinedAt: new Date(2025, (i * 2) % 12, 4 + i).toISOString(),
  lastOrderAt: new Date(2026, 7, 24 - i).toISOString(),
}))

const CUSTOMER_BY_ID = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c]))

/* ---------------------------------------------------------------- Orders */

const ORDER_STATUS_CYCLE: OrderStatus[] = [
  'delivered',
  'delivered',
  'shipped',
  'packed',
  'confirmed',
  'pending',
  'out-for-delivery',
  'cancelled',
  'delivered',
  'returned',
  'delivered',
  'shipped',
  'confirmed',
  'delivered',
]

const PAYMENT_CYCLE: PaymentStatus[] = [
  'paid', 'paid', 'paid', 'processing', 'pending', 'pending', 'paid',
  'failed', 'paid', 'refunded', 'paid', 'paid', 'processing', 'paid',
]

const METHOD_CYCLE: PaymentMethod[] = [
  'razorpay', 'upi', 'card', 'razorpay', 'cod', 'upi', 'card',
  'razorpay', 'netbanking', 'upi', 'razorpay', 'card', 'upi', 'cod',
]

function toLineItem(slug: string, quantity: number): OrderLineItem {
  const product = PRODUCT_BY_SLUG[slug]!
  return {
    productId: product.id,
    name: product.name,
    image: product.images[0]!,
    unit: product.unit,
    price: product.price,
    quantity,
    sku: product.sku,
  }
}

function buildTimeline(status: OrderStatus, placedAt: Date, paymentStatus: PaymentStatus): OrderTimelineEntry[] {
  const order: Array<{ key: OrderTimelineEntry['status']; label: string }> = [
    { key: 'placed', label: 'Order placed' },
    { key: 'confirmed', label: 'Order confirmed' },
    { key: 'packed', label: 'Packed' },
    { key: 'shipped', label: 'Shipped' },
    { key: 'out-for-delivery', label: 'Out for delivery' },
    { key: 'delivered', label: 'Delivered' },
  ]
  const statusIndex = order.findIndex((entry) => entry.key === status)
  const activeIndex = status === 'cancelled' || status === 'returned' ? 1 : statusIndex === -1 ? 1 : statusIndex

  return order.map((entry, index) => ({
    status: entry.key,
    label: entry.label,
    completed: index <= activeIndex,
    at: new Date(placedAt.getTime() + index * 22 * 3_600_000).toISOString(),
    note:
      index === 0 && paymentStatus === 'paid'
        ? 'Payment captured securely via Razorpay'
        : index === 0
          ? 'Awaiting payment confirmation'
          : undefined,
  }))
}

const ORDER_RECIPES: Array<Array<[string, number]>> = [
  [['foxtail-millet-laddu', 2], ['ragi-jaggery-laddu', 1]],
  [['ragi-roti-ready-to-cook', 3]],
  [['organic-foxtail-millet', 2], ['organic-kodo-millet', 1], ['native-red-rice', 1]],
  [['barnyard-millet-dry-fruit-laddu', 2], ['multi-millet-ghee-malt', 1]],
  [['sprouted-ragi-malt-mix', 1], ['millet-jaggery-cookies', 2]],
  [['dry-fruit-energy-bar', 3]],
  [['multigrain-millet-roti', 2], ['jowar-roti-ready-to-cook', 1]],
  [['foxtail-millet-laddu', 4], ['seed-jaggery-chikki', 2]],
  [['organic-little-millet', 2], ['unpolished-toor-dal', 1]],
  [['ragi-almond-laddu', 2]],
  [['millet-upma-mix', 2], ['traditional-ghee-pongal-mix', 2]],
  [['heirloom-khapli-wheat', 2], ['native-red-rice', 2]],
  [['kodo-millet-jaggery-laddu', 1], ['millet-sesame-laddu', 1]],
  [['millet-jaggery-cookies', 4], ['dry-fruit-energy-bar', 1], ['foxtail-millet-laddu', 1]],
]

export function computeTotals(items: OrderLineItem[], couponDiscount = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const savings = items.reduce(
    (sum, item) => sum + Math.max(0, (PRODUCT_BY_SLUG_BY_ID[item.productId]?.mrp ?? item.price) - item.price) * item.quantity,
    0,
  )
  const shipping = subtotal >= 999 ? 0 : 79
  const tax = Math.round(subtotal * 0.05)
  const total = subtotal - couponDiscount + shipping + tax
  return { subtotal, savings, shipping, tax, discount: couponDiscount, total }
}

const PRODUCT_BY_SLUG_BY_ID: Record<string, { mrp: number }> = Object.fromEntries(
  PRODUCTS.map((p) => [p.id, { mrp: p.mrp }]),
)

export const ORDERS: Order[] = ORDER_RECIPES.map((recipe, i) => {
  const customer = CUSTOMER_BY_ID[`cus-${String((i % CUSTOMERS.length) + 1).padStart(3, '0')}`]!
  const items = recipe.map(([slug, qty]) => toLineItem(slug, qty))
  const couponDiscount = i % 4 === 0 ? 100 : 0
  const totals = computeTotals(items, couponDiscount)
  const status = ORDER_STATUS_CYCLE[i]!
  const paymentStatus = PAYMENT_CYCLE[i]!
  const placedAt = new Date(2026, 7, 26 - i * 2)

  return {
    id: `ord-${String(i + 1).padStart(4, '0')}`,
    orderNumber: `VF-2026-${String(1042 + i).padStart(5, '0')}`,
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email,
    items,
    subtotal: totals.subtotal,
    savings: totals.savings,
    shipping: totals.shipping,
    tax: totals.tax,
    discount: totals.discount,
    total: totals.total,
    status,
    paymentStatus,
    paymentMethod: METHOD_CYCLE[i]!,
    address: customer.addresses[0]!,
    couponCode: couponDiscount ? 'VEDHI100' : undefined,
    timeline: buildTimeline(status, placedAt, paymentStatus),
    placedAt: placedAt.toISOString(),
    updatedAt: new Date(placedAt.getTime() + 30 * 3_600_000).toISOString(),
    invoiceId: `inv-${String(i + 1).padStart(4, '0')}`,
    trackingNumber: status === 'shipped' || status === 'out-for-delivery' || status === 'delivered'
      ? `VDH${9000000 + i * 77}`
      : undefined,
    courier: status === 'shipped' || status === 'out-for-delivery' || status === 'delivered'
      ? ['BlueDart', 'Delhivery', 'Shiprocket'][i % 3]
      : undefined,
  }
})

/* -------------------------------------------------------------- Invoices */

export const INVOICES: Invoice[] = ORDERS.map((order, i) => ({
  id: order.invoiceId!,
  invoiceNumber: `INV/2026/${String(2041 + i).padStart(4, '0')}`,
  orderId: order.id,
  orderNumber: order.orderNumber,
  customerName: order.customerName,
  customerEmail: order.customerEmail,
  billingAddress: order.address,
  shippingAddress: order.address,
  items: order.items,
  subtotal: order.subtotal,
  discount: order.discount,
  shipping: order.shipping,
  tax: order.tax,
  total: order.total,
  status: order.paymentStatus === 'paid' ? 'paid' : order.paymentStatus === 'refunded' ? 'cancelled' : 'issued',
  issuedAt: order.placedAt,
  dueAt: order.placedAt,
  gstin: `29ABCDE1234F1Z${(i % 9) + 1}`,
}))

/* -------------------------------------------------------------- Delivery */

const DELIVERY_STATUS = [
  'delivered', 'delivered', 'in-transit', 'assigned', 'unassigned', 'unassigned',
  'in-transit', 'failed', 'delivered', 'delivered', 'delivered', 'picked-up',
  'assigned', 'delivered',
] as const

export const DELIVERIES: Delivery[] = ORDERS.map((order, i) => ({
  id: `dlv-${String(i + 1).padStart(4, '0')}`,
  orderId: order.id,
  orderNumber: order.orderNumber,
  customerName: order.customerName,
  city: order.address.city,
  status: DELIVERY_STATUS[i % DELIVERY_STATUS.length]!,
  partnerId: DELIVERY_STATUS[i % DELIVERY_STATUS.length] === 'unassigned' ? undefined : `dpt-00${(i % 3) + 1}`,
  partnerName: DELIVERY_STATUS[i % DELIVERY_STATUS.length] === 'unassigned' ? undefined : ['Ravi Kumar', 'Suresh N', 'Imran S'][i % 3],
  trackingNumber: order.trackingNumber,
  expectedAt: new Date(new Date(order.placedAt).getTime() + 3 * 86_400_000).toISOString(),
  deliveredAt:
    DELIVERY_STATUS[i % DELIVERY_STATUS.length] === 'delivered'
      ? new Date(new Date(order.placedAt).getTime() + 2 * 86_400_000).toISOString()
      : undefined,
}))

/* ------------------------------------------------------------- Discounts */

export const DISCOUNTS: Discount[] = [
  {
    id: 'dsc-001',
    code: 'VEDHI100',
    label: 'Flat ₹100 off your first order',
    type: 'flat',
    value: 100,
    minOrderValue: 799,
    maxUses: 5000,
    usedCount: 1284,
    appliesTo: 'all',
    targetIds: [],
    startsAt: new Date(2026, 0, 1).toISOString(),
    expiresAt: new Date(2026, 11, 31).toISOString(),
    active: true,
  },
  {
    id: 'dsc-002',
    code: 'FESTIVE15',
    label: '15% off festive gifting hampers',
    type: 'percent',
    value: 15,
    minOrderValue: 1499,
    maxUses: 2000,
    usedCount: 642,
    appliesTo: 'all',
    targetIds: [],
    startsAt: new Date(2026, 8, 1).toISOString(),
    expiresAt: new Date(2026, 9, 31).toISOString(),
    active: true,
  },
  {
    id: 'dsc-003',
    code: 'FREESHIP',
    label: 'Free shipping on any order',
    type: 'shipping',
    value: 79,
    minOrderValue: 499,
    maxUses: 10000,
    usedCount: 3311,
    appliesTo: 'all',
    targetIds: [],
    startsAt: new Date(2026, 5, 1).toISOString(),
    expiresAt: new Date(2026, 11, 31).toISOString(),
    active: true,
  },
  {
    id: 'dsc-004',
    code: 'MILLET20',
    label: '20% off organic millet range',
    type: 'percent',
    value: 20,
    minOrderValue: 999,
    maxUses: 1000,
    usedCount: 1000,
    appliesTo: 'category',
    targetIds: ['cat-organic-millets'],
    startsAt: new Date(2026, 3, 1).toISOString(),
    expiresAt: new Date(2026, 5, 30).toISOString(),
    active: false,
  },
  {
    id: 'dsc-005',
    code: 'RAGI50',
    label: '₹50 off ragi specials',
    type: 'flat',
    value: 50,
    minOrderValue: 399,
    maxUses: 3000,
    usedCount: 419,
    appliesTo: 'category',
    targetIds: ['cat-ragi-specials'],
    startsAt: new Date(2026, 7, 1).toISOString(),
    expiresAt: new Date(2026, 10, 30).toISOString(),
    active: true,
  },
]

export const PROMOTIONS: Promotion[] = [
  {
    id: 'prm-001',
    title: 'Festive Millet Hampers',
    subtitle: 'Curated gifting boxes with free handwritten notes',
    placement: 'hero',
    ctaLabel: 'Explore hampers',
    ctaHref: '/shop?tag=Gifting',
    active: true,
    startsAt: new Date(2026, 8, 1).toISOString(),
    expiresAt: new Date(2026, 10, 15).toISOString(),
  },
  {
    id: 'prm-002',
    title: 'Free shipping above ₹999',
    subtitle: 'Across all serviceable PIN codes in India',
    placement: 'strip',
    ctaLabel: 'Start shopping',
    ctaHref: '/shop',
    active: true,
    startsAt: new Date(2026, 0, 1).toISOString(),
    expiresAt: new Date(2026, 11, 31).toISOString(),
  },
  {
    id: 'prm-003',
    title: 'Subscribe & save 12%',
    subtitle: 'Monthly millet essentials delivered on repeat',
    placement: 'collection',
    ctaLabel: 'Build a box',
    ctaHref: '/shop?tag=Everyday',
    active: false,
    startsAt: new Date(2026, 7, 1).toISOString(),
    expiresAt: new Date(2026, 11, 1).toISOString(),
  },
]

/* ----------------------------------------------------------------- Staff */

export const PERMISSIONS: Permission[] = [
  'products:read', 'products:write', 'categories:read', 'categories:write',
  'inventory:read', 'inventory:write', 'orders:read', 'orders:write',
  'customers:read', 'customers:write', 'delivery:read', 'delivery:write',
  'invoices:read', 'invoices:write', 'discounts:read', 'discounts:write',
  'promotions:read', 'promotions:write', 'payments:read', 'payments:write',
  'support:read', 'support:write', 'settings:read', 'settings:write',
  'theme:write', 'logo:write', 'contact:write', 'staff:read', 'staff:write',
  'audit:read', 'security:write',
]

export const ROLES: Role[] = [
  {
    name: 'owner',
    label: 'Owner',
    description: 'Full access including billing, staff and security.',
    permissions: PERMISSIONS,
    system: true,
  },
  {
    name: 'admin',
    label: 'Administrator',
    description: 'Everything except staff management and security.',
    permissions: PERMISSIONS.filter((p) => !['staff:write', 'security:write'].includes(p)),
    system: true,
  },
  {
    name: 'manager',
    label: 'Operations Manager',
    description: 'Orders, inventory, delivery and discounts.',
    permissions: [
      'products:read', 'products:write', 'categories:read', 'categories:write',
      'inventory:read', 'inventory:write',
      'orders:read', 'orders:write', 'delivery:read', 'delivery:write',
      'discounts:read', 'discounts:write', 'promotions:read', 'promotions:write',
      'invoices:read', 'payments:read',
    ],
    system: false,
  },
  {
    name: 'inventory',
    label: 'Inventory Lead',
    description: 'Stock, product catalogue and purchase entries.',
    permissions: ['products:read', 'products:write', 'categories:read', 'categories:write', 'inventory:read', 'inventory:write'],
    system: false,
  },
  {
    name: 'support',
    label: 'Customer Support',
    description: 'Customer records, orders and support tickets.',
    permissions: ['orders:read', 'orders:write', 'customers:read', 'support:read', 'support:write'],
    system: false,
  },
  {
    name: 'viewer',
    label: 'Read-only Analyst',
    description: 'View dashboards and reports without editing.',
    permissions: ['products:read', 'categories:read', 'orders:read', 'customers:read', 'invoices:read', 'discounts:read', 'audit:read'],
    system: false,
  },
]

export const STAFF: StaffMember[] = [
  { id: 'stf-001', name: 'Vedhi Krishnan', email: 'vedhi@vedhifoods.example', phone: '9845000001', role: 'owner', employeeId: 'EMP-001', status: 'active', lastActiveAt: new Date(2026, 8, 17, 9, 12).toISOString(), createdAt: new Date(2024, 0, 8).toISOString() },
  { id: 'stf-002', name: 'Anita Sharma', email: 'anita@vedhifoods.example', phone: '9845000002', role: 'manager', employeeId: 'EMP-002', status: 'active', lastActiveAt: new Date(2026, 8, 17, 8, 40).toISOString(), createdAt: new Date(2024, 2, 14).toISOString() },
  { id: 'stf-003', name: 'Rohit Nambiar', email: 'rohit@vedhifoods.example', phone: '9845000003', role: 'inventory', employeeId: 'EMP-003', status: 'active', lastActiveAt: new Date(2026, 8, 16, 18, 5).toISOString(), createdAt: new Date(2024, 6, 2).toISOString() },
  { id: 'stf-004', name: 'Fatima Sheikh', email: 'fatima@vedhifoods.example', phone: '9845000004', role: 'support', employeeId: 'EMP-004', status: 'active', lastActiveAt: new Date(2026, 8, 17, 10, 2).toISOString(), createdAt: new Date(2025, 1, 20).toISOString() },
  { id: 'stf-005', name: 'Gaurav Patel', email: 'gaurav@vedhifoods.example', phone: '9845000005', role: 'viewer', employeeId: 'EMP-005', status: 'invited', createdAt: new Date(2026, 7, 30).toISOString() },
  { id: 'stf-006', name: 'Deepa Menon', email: 'deepa@vedhifoods.example', phone: '9845000006', role: 'admin', employeeId: 'EMP-006', status: 'suspended', lastActiveAt: new Date(2026, 5, 11, 14, 22).toISOString(), createdAt: new Date(2024, 8, 5).toISOString() },
]

/* --------------------------------------------------------- Support tickets */

export const SUPPORT_TICKETS: SupportTicket[] = [
  {
    id: 'tic-001',
    ticketNumber: 'TKT-2026-0041',
    customerName: 'Ananya Rao',
    customerEmail: 'ananya.rao@example.com',
    subject: 'Laddu pack arrived slightly crushed',
    message: 'The Foxtail Millet Laddu box arrived with two laddus broken. Taste is fine but the gifting box was damaged.',
    category: 'order',
    priority: 'high',
    status: 'in-progress',
    createdAt: new Date(2026, 8, 17, 9, 12).toISOString(),
    updatedAt: new Date(2026, 8, 17, 11, 5).toISOString(),
    assigneeId: 'stf-004',
    assigneeName: 'Fatima Sheikh',
  },
  {
    id: 'tic-002',
    ticketNumber: 'TKT-2026-0040',
    customerName: 'Vikram Menon',
    customerEmail: 'vikram.menon@example.com',
    subject: 'Coupon MILLET20 not applying',
    message: 'I add two organic millet packs to the cart but the MILLET20 coupon does not reduce anything at checkout.',
    category: 'payment',
    priority: 'normal',
    status: 'resolved',
    createdAt: new Date(2026, 8, 16, 18, 40).toISOString(),
    updatedAt: new Date(2026, 8, 17, 8, 55).toISOString(),
    assigneeId: 'stf-004',
    assigneeName: 'Fatima Sheikh',
  },
  {
    id: 'tic-003',
    ticketNumber: 'TKT-2026-0039',
    customerName: 'Meera Iyer',
    customerEmail: 'meera.iyer@example.com',
    subject: 'My order VF-2026-01048 has no tracking update',
    message: 'Order marked shipped on Monday but no tracking information is visible for two days. Please confirm the courier.',
    category: 'delivery',
    priority: 'urgent',
    status: 'open',
    createdAt: new Date(2026, 8, 17, 7, 22).toISOString(),
    updatedAt: new Date(2026, 8, 17, 7, 22).toISOString(),
  },
  {
    id: 'tic-004',
    ticketNumber: 'TKT-2026-0038',
    customerName: 'Divya Sharma',
    customerEmail: 'divya.sharma@example.com',
    subject: 'Dietary query for sugar content',
    message: 'We are managing blood sugar at home. Could you confirm the natural sugar content per laddu for the Foxtail range?',
    category: 'product',
    priority: 'low',
    status: 'open',
    createdAt: new Date(2026, 8, 15, 15, 10).toISOString(),
    updatedAt: new Date(2026, 8, 15, 15, 10).toISOString(),
  },
  {
    id: 'tic-005',
    ticketNumber: 'TKT-2026-0037',
    customerName: 'Rahul Deshpande',
    customerEmail: 'rahul.d@example.com',
    subject: 'Refund for cancelled order',
    message: 'Order VF-2026-01053 was cancelled but I have not received the refund in 6 days. Can you check with the bank?',
    category: 'returns',
    priority: 'high',
    status: 'in-progress',
    createdAt: new Date(2026, 8, 14, 12, 30).toISOString(),
    updatedAt: new Date(2026, 8, 16, 10, 15).toISOString(),
    assigneeId: 'stf-004',
    assigneeName: 'Fatima Sheikh',
  },
  {
    id: 'tic-006',
    ticketNumber: 'TKT-2026-0036',
    customerName: 'Priya Nair',
    customerEmail: 'priya.nair@example.com',
    subject: 'Bulk order for Onam hampers',
    message: 'We need 60 festive hampers for corporate clients by mid-September. Please share wholesale terms and lead time.',
    category: 'other',
    priority: 'normal',
    status: 'closed',
    createdAt: new Date(2026, 8, 10, 11, 0).toISOString(),
    updatedAt: new Date(2026, 8, 12, 17, 45).toISOString(),
    assigneeId: 'stf-002',
    assigneeName: 'Anita Sharma',
  },
]

/* ------------------------------------------------------- Delivery partners */

export const DELIVERY_PARTNERS: DeliveryPartner[] = [
  { id: 'dpt-001', name: 'Ravi Kumar', phone: '9845090001', vehicle: 'TVS XL', active: true },
  { id: 'dpt-002', name: 'Suresh N', phone: '9845090002', vehicle: 'Honda Activa', active: true },
  { id: 'dpt-003', name: 'Imran S', phone: '9845090003', vehicle: 'Swiggy fleet', active: true },
  { id: 'dpt-004', name: 'Kavitha R', phone: '9845090004', vehicle: 'Zomato fleet', active: false },
]

/* ------------------------------------------------------------ Audit logs */

const AUDIT_SEED: Array<[string, AuditLog['action'], string, string, AuditLog['tone']]> = [
  ['Vedhi Krishnan', 'update', 'WebsiteSettings', 'Changed brand accent colour to Gold 500', 'info'],
  ['Anita Sharma', 'update', 'Order #VF-2026-01046', 'Status changed to Packed', 'success'],
  ['Rohit Nambiar', 'update', 'Product "Organic Foxtail Millet"', 'Stock increased by 120 units', 'success'],
  ['Fatima Sheikh', 'create', 'Discount "RAGI50"', 'Created a category-level coupon', 'info'],
  ['Vedhi Krishnan', 'login', 'Admin session', 'Signed in from a new device', 'warning'],
  ['Deepa Menon', 'delete', 'Product "Millet Sesame Laddu"', 'Attempted deletion — permission denied', 'danger'],
  ['Anita Sharma', 'export', 'Orders CSV', 'Exported 214 orders for August', 'neutral'],
  ['Rohit Nambiar', 'settings', 'Payment gateway', 'Switched Razorpay to live mode', 'warning'],
  ['Fatima Sheikh', 'update', 'Customer "Divya Sharma"', 'Marked account as blocked', 'danger'],
  ['Vedhi Krishnan', 'create', 'Staff "Gaurav Patel"', 'Invitation sent with Viewer role', 'info'],
]

export const AUDIT_LOGS: AuditLog[] = AUDIT_SEED.map(([actor, action, entity, summary, tone], i) => ({
  id: `log-${String(i + 1).padStart(4, '0')}`,
  actor,
  actorRole: (['owner', 'manager', 'inventory', 'support', 'owner', 'admin', 'manager', 'inventory', 'support', 'owner'] as const)[i]!,
  action,
  entity,
  entityId: `ent-${i + 1}`,
  summary,
  ipAddress: `49.207.${10 + i}.${100 + i * 3}`,
  tone,
  createdAt: new Date(2026, 8, 17, 10 - i, (i * 7) % 60).toISOString(),
}))

/* ------------------------------------------------------------ Dashboards */

export const DASHBOARD_METRICS: DashboardMetric[] = [
  { id: 'revenue', label: 'Revenue (30d)', value: '₹4,82,940', delta: 18.4, trend: 'up', hint: 'vs ₹4,07,860 last month', tone: 'success' },
  { id: 'orders', label: 'Orders', value: '1,284', delta: 12.1, trend: 'up', hint: '214 awaiting fulfilment', tone: 'info' },
  { id: 'aov', label: 'Avg. order value', value: '₹1,326', delta: 5.6, trend: 'up', hint: 'Target ₹1,400', tone: 'accent' },
  { id: 'repeat', label: 'Repeat rate', value: '38.2%', delta: -2.3, trend: 'down', hint: '482 returning customers', tone: 'warning' },
  { id: 'conversion', label: 'Conversion rate', value: '2.94%', delta: 0.4, trend: 'up', hint: '42,880 store sessions', tone: 'info' },
  { id: 'profit', label: 'Gross profit', value: '₹1,18,430', delta: 9.2, trend: 'up', hint: '24.5% margin', tone: 'success' },
  { id: 'customers', label: 'New customers', value: '312', delta: 14.8, trend: 'up', hint: 'vs 272 last month', tone: 'accent' },
  { id: 'tickets', label: 'Open support tickets', value: '14', delta: -9.0, trend: 'down', hint: '3 urgent priority', tone: 'danger' },
  { id: 'lowstock', label: 'Low stock items', value: '12', delta: 3, trend: 'up', hint: '3 out of stock', tone: 'warning' },
  { id: 'delivery', label: 'Delivery success', value: '98.1%', delta: 0.6, trend: 'up', hint: '12,940 shipments', tone: 'success' },
]

export const REVENUE_SERIES: RevenuePoint[] = [
  { label: 'Wk 21', revenue: 84200, orders: 231 },
  { label: 'Wk 22', revenue: 91100, orders: 248 },
  { label: 'Wk 23', revenue: 87800, orders: 241 },
  { label: 'Wk 24', revenue: 102400, orders: 276 },
  { label: 'Wk 25', revenue: 110700, orders: 295 },
  { label: 'Wk 26', revenue: 121300, orders: 308 },
  { label: 'Wk 27', revenue: 138600, orders: 342 },
  { label: 'Wk 28', revenue: 147200, orders: 361 },
  { label: 'Wk 29', revenue: 158300, orders: 384 },
  { label: 'Wk 30', revenue: 169800, orders: 405 },
]

export const TOP_PRODUCTS: TopProduct[] = PRODUCTS.filter((p) => p.isBestSeller || p.isFeatured)
  .slice(0, 5)
  .map((product, i) => ({
    productId: product.id,
    name: product.name,
    image: product.images[0]!,
    unitsSold: 420 - i * 58,
    revenue: (420 - i * 58) * product.price,
  }))

export const ORDER_STATUS_BREAKDOWN = [
  { label: 'Delivered', value: 742, tone: 'success' as const },
  { label: 'In transit', value: 216, tone: 'info' as const },
  { label: 'Processing', value: 184, tone: 'warning' as const },
  { label: 'Cancelled', value: 92, tone: 'danger' as const },
  { label: 'Returned', value: 50, tone: 'neutral' as const },
]

export const INVENTORY_ALERTS = PRODUCTS.filter((p) => p.stock <= 60)
  .sort((a, b) => a.stock - b.stock)
  .slice(0, 6)
  .map((product) => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    image: product.images[0]!,
    stock: product.stock,
    reorderLevel: 60,
  }))
