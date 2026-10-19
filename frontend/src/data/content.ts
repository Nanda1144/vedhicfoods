/**
 * Form enumerations shared by the contact and support screens.
 *
 * These are UI choices, not server data — testimonials, FAQs and reviews all
 * come from the CMS (`GET /content/*`).
 */
export const CONTACT_TOPICS = [
  'Order support',
  'Product enquiry',
  'Wholesale / bulk',
  'Corporate gifting',
  'Partnership',
  'Something else',
] as const

export const SUPPORT_CATEGORIES = [
  { id: 'order', title: 'Order & delivery', copy: 'Track, modify or cancel an order' },
  { id: 'payment', title: 'Payments & refunds', copy: 'Failed payments, refunds and invoices' },
  { id: 'product', title: 'Product help', copy: 'Ingredients, storage and usage' },
  { id: 'wholesale', title: 'Wholesale & gifting', copy: 'Bulk pricing and custom hampers' },
] as const
