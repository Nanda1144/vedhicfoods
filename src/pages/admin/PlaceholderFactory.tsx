import { AdminPageHeader, PagePlaceholder } from '@/components/admin'
import type { IconName } from '@/components/common'

interface PlaceholderSpec {
  title: string
  description: string
  eyebrow: string
  icon: IconName
  features: string[]
}

const SPECS: Record<string, PlaceholderSpec> = {
  'products-new': {
    title: 'Add a new product',
    eyebrow: 'Catalogue',
    icon: 'plus',
    description: 'The full product creation flow — pricing, variants, nutrition, photos and SEO — is implemented in the Admin phase.',
    features: [
      'Name, pack unit and category',
      'MRP vs selling price & stock',
      'Organic / bestseller / new flags',
      'Ingredients, allergens & nutrition table',
    ],
  },
  'products-edit': {
    title: 'Edit product',
    eyebrow: 'Catalogue',
    icon: 'edit',
    description: 'Editing an existing product reuses the same form as creation. This placeholder will be wired up in the Admin phase.',
    features: [
      'In-place price & stock updates',
      'Flag toggles with audit log entry',
      'Temp-free photo replacement',
    ],
  },
  inventory: {
    title: 'Inventory',
    eyebrow: 'Catalogue',
    icon: 'package-open',
    description: 'A live low-stock view, reorder suggestions and stock-adjustment log will live here.',
    features: [
      'Low-stock & out-of-stock alerts',
      'Per-SKU batch & expiry tracking',
      'Manual adjustments with audit trail',
    ],
  },
  customers: {
    title: 'Customers',
    eyebrow: 'Sales',
    icon: 'users',
    description: 'Customer profiles, lifetime value, addresses, and marketing opt-ins will be managed here.',
    features: [
      'Customer lifetime value & cohort view',
      'Address book & contact permissions',
      'Order history drill-down',
    ],
  },
  delivery: {
    title: 'Delivery',
    eyebrow: 'Sales',
    icon: 'truck',
    description: 'Dispatch zones, partner/courier assignment, ETA updates and POD capture will be managed here.',
    features: [
      'Assign orders to couriers & partners',
      'Zone-wise delivery ETA',
      'Proof-of-delivery capture',
    ],
  },
  invoices: {
    title: 'Invoices',
    eyebrow: 'Sales',
    icon: 'download',
    description: 'GST-compliant invoice management, re-issuing and e-mailing will be built here.',
    features: [
      'Auto-issue on payment capture',
      'Re-print & re-email copies',
      'GSTIN validation on business orders',
    ],
  },
  discounts: {
    title: 'Discounts',
    eyebrow: 'Sales',
    icon: 'tag',
    description: 'Create and schedule coupons: percent, flat and free-shipping, with usage caps.',
    features: [
      'Percent / flat / shipping coupons',
      'Usage limits & validity windows',
      'Auto-disable at cap',
    ],
  },
  promotions: {
    title: 'Promotions',
    eyebrow: 'Sales',
    icon: 'sparkles',
    description: 'Hero banners, announcement strips and pop-ups scheduled for seasonal campaigns.',
    features: [
      'Hero, strip, popup & collection slots',
      'Publish schedules with targeting',
      'Campaign performance readouts',
    ],
  },
  support: {
    title: 'Support',
    eyebrow: 'Operations',
    icon: 'mail',
    description: 'Customer tickets, responses and SLA tracking will be managed here.',
    features: [
      'Ticket inbox with priorities',
      'Order-linked context',
      'Templates & canned replies',
    ],
  },
  staff: {
    title: 'Staff',
    eyebrow: 'Operations',
    icon: 'users',
    description: 'Team members, roles and permission assignment will be managed here.',
    features: [
      'Invite & suspend members',
      'Assign roles & permissions',
      'Last-active visibility',
    ],
  },
  'staff-new': {
    title: 'Invite a team member',
    eyebrow: 'Operations',
    icon: 'plus',
    description: 'The invite flow — name, email, role and permissions — will be built in the Admin phase.',
    features: ['Role & permission assignment', 'Invite email with expiry', 'Audit-logged changes'],
  },
  'staff-edit': {
    title: 'Edit staff member',
    eyebrow: 'Operations',
    icon: 'edit',
    description: 'Updating a team member\u2019s role, status or permissions will live on this screen.',
    features: ['Role reassignment', 'Suspend / reinstate', 'Full audit history'],
  },
  'audit-logs': {
    title: 'Audit logs',
    eyebrow: 'Operations',
    icon: 'clock',
    description: 'An immutable, searchable log of every privileged action across the console.',
    features: [
      'Who did what, when, from where',
      'Filter by actor, entity & action',
      'Export to CSV',
    ],
  },
  settings: {
    title: 'Settings',
    eyebrow: 'System',
    icon: 'sliders',
    description: 'Branding, announcement bar, business hours and contact details will be edited here.',
    features: [
      'Brand name, tagline & announcement',
      'Support contact & business hours',
      'Theme accent presets',
    ],
  },
  'payment-settings': {
    title: 'Payment settings',
    eyebrow: 'System',
    icon: 'wallet',
    description: 'Razorpay credentials, enabled methods, COD rules and webhook configuration will live here.',
    features: [
      'Razorpay key & webhook secret',
      'Enable UPI / card / netbanking / COD',
      'COD order limit',
    ],
  },
  security: {
    title: 'Security',
    eyebrow: 'System',
    icon: 'shield',
    description: 'Two-factor enrolment, session management and password policy will be managed here.',
    features: ['2FA for admin accounts', 'Active-session management', 'Password policy & reset rules'],
  },
  'orders-detail': {
    title: 'Order detail',
    eyebrow: 'Sales',
    icon: 'cart',
    description: 'The full order view — timeline, fulfilment actions, printing and refunds — will be built in the Admin phase.',
    features: [
      'Status timeline with actions',
      'Refund & invoice shortcuts',
      'Customer & address context',
    ],
  },
  'customers-detail': {
    title: 'Customer detail',
    eyebrow: 'Sales',
    icon: 'user',
    description: 'The profile, order history and address book for a single customer.',
    features: ['Lifetime orders & spend', 'Address book', 'Marketing opt-in control'],
  },
  'delivery-create': {
    title: 'Create delivery',
    eyebrow: 'Sales',
    icon: 'truck',
    description: 'Assigning a courier/partner and expected ETA for one or many orders.',
    features: ['Bulk assignment', 'ETA & zone selection', 'Dispatch notes'],
  },
}

export function PlaceholderFactory({ pageKey, fallbackTitle, fallbackIcon }: { pageKey: string; fallbackTitle: string; fallbackIcon: IconName }) {
  const spec = SPECS[pageKey] ?? {
    title: fallbackTitle,
    eyebrow: 'Admin',
    icon: fallbackIcon,
    description: 'This screen is implemented in the Admin phase. The structure is already reserved here.',
    features: ['Structured for the next build phase'],
  }

  return (
    <>
      <AdminPageHeader title={spec.title} description={spec.description} />
      <PagePlaceholder
        icon={spec.icon}
        eyebrow={spec.eyebrow}
        title={spec.title}
        description={spec.description}
        features={spec.features}
      />
    </>
  )
}