import type { WebsiteSettings } from '@/types'

/**
 * Single source of truth for brand identity & business configuration.
 * In production this shape is hydrated from the backend `WebsiteSettings`
 * entity (admin → settings). Components read it through `settingsService`.
 */
export const SITE = {
  brandName: 'Vedhi Foods',
  brandShort: 'Vedhi',
  tagline: 'Traditional. Organic. Premium.',
  description:
    'Handcrafted millet laddus, ragi roti and heritage organic grains — sourced directly from trusted Indian farms and made in small batches.',
  url: 'https://vedhifoods.example',
  supportEmail: 'care@vedhifoods.example',
  supportPhone: '+91 90000 12345',
  whatsapp: '+91 90000 12345',
  gstin: '29ABCDE1234F1Z5',
  currency: 'INR' as const,
  currencySymbol: '₹',
  freeShippingThreshold: 999,
  standardShippingFee: 79,
  taxRate: 0.05,
  announcement: 'Free shipping on orders above ₹999 · Freshly made every week',
  socials: [
    { platform: 'instagram' as const, label: 'Instagram', href: 'https://instagram.com' },
    { platform: 'facebook' as const, label: 'Facebook', href: 'https://facebook.com' },
    { platform: 'youtube' as const, label: 'YouTube', href: 'https://youtube.com' },
  ],
} as const

export const DEFAULT_WEBSITE_SETTINGS: WebsiteSettings = {
  brandName: SITE.brandName,
  tagline: SITE.tagline,
  supportEmail: SITE.supportEmail,
  supportPhone: SITE.supportPhone,
  whatsapp: SITE.whatsapp,
  addressLine: 'No. 14, Heritage Farms Road, Kanakapura Main Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560062',
  currency: 'INR',
  gstin: SITE.gstin,
  freeShippingThreshold: SITE.freeShippingThreshold,
  standardShippingFee: SITE.standardShippingFee,
  taxRate: SITE.taxRate,
  announcement: SITE.announcement,
  announcementActive: true,
  socials: [...SITE.socials],
  businessHours: 'Mon – Sat · 9:00 AM to 7:00 PM IST',
}

export const COMPANY_MILESTONES = [
  { year: '2009', title: 'A family kitchen', copy: 'Recipes passed down three generations, first sold at a village market.' },
  { year: '2016', title: 'Direct from farms', copy: 'We partnered with 40+ smallholder organic farmers across Karnataka.' },
  { year: '2021', title: 'Certified organic', copy: 'Every grain lot traceable to a single farm and harvest season.' },
  { year: 'Today', title: 'Slow-made at scale', copy: 'Small-batch production with zero preservatives, shipped nationwide.' },
] as const

export const TRUST_BADGES = [
  { icon: 'leaf', title: 'Certified Organic', copy: 'India Organic & Jaivik Bharat certified sourcing.' },
  { icon: 'shield', title: 'No Preservatives', copy: 'Zero artificial colours, flavours or additives.' },
  { icon: 'truck', title: 'Fresh Dispatch', copy: 'Made in small batches, shipped within 48 hours.' },
  { icon: 'award', title: 'Farmer Direct', copy: 'Fair-trade pricing to 40+ partner farms.' },
] as const

export const STORAGE_KEYS = {
  cart: 'vedhi.cart.v1',
  theme: 'vedhi.theme.v1',
  settings: 'vedhi.settings.v1',
  coupon: 'vedhi.coupon.v1',
  orders: 'vedhi.orders.v1',
  adminSession: 'vedhi.admin.session.v1',
  adminData: 'vedhi.admin.data.v1',
  recentProducts: 'vedhi.recent.v1',
} as const
